const riskEvaluationRepository = require("../repositories/riskEvaluationRepository");
const ruleSetRepository = require("../repositories/ruleSetRepository");
const accountProjectionRepository = require("../repositories/accountProjectionRepository");
const { evaluateSchema } = require("./schemas/evaluateSchema");
const riskRules = require("./rules/riskRules");

/**
 * @typedef {Object} EvaluateDTO
 * @property {string} tx_id          id da transação no transactions (idempotência)
 * @property {string} origin_account uuid da conta origem
 * @property {string} dest_key       chave Pix ou conta destino
 * @property {number} amount         valor em centavos
 * @property {string} channel        canal de origem (ex.: PIX)
 * @property {Date}   created_at     momento da transação
 */

/**
 * @typedef {"APPROVE" | "REVIEW" | "DENY"} Decision
 */

/**
 * @typedef {Object} EvaluateResponse
 * @property {Decision} decision
 * @property {number}   score        0–100
 * @property {string}   rule_version versão do rule set usado na decisão
 * @property {string[]} reasons      regras que dispararam, ex.: "DEST_NEW:+15"
 */

/**
 * @typedef {Object} Features
 * @property {number}      velocity_count   avaliações da origem na janela de velocity
 * @property {number|null} avg_ticket       ticket médio aprovado na janela; null = sem histórico
 * @property {boolean}     dest_seen_before origem já teve transação aprovada pra esse destino
 * @property {number|null} account_age_hours idade da conta origem; null = sem projeção
 */

const MAX_SCORE = 100;

/**
 * @param {EvaluateDTO} data
 * @param {Object} rules
 * @returns {Promise<Features>}
 */
const loadFeatures = async (data, rules) => {
    const now = Date.now();
    const minutesAgo = (m) => new Date(now - m * 60 * 1000);
    const daysAgo = (d) => new Date(now - d * 24 * 60 * 60 * 1000);

    const [velocity_count, avg_ticket, seenRows, [account]] = await Promise.all([
        // tentativa também é sinal de risco: conta todas as decisões
        rules.VELOCITY
            ? riskEvaluationRepository.count({
                where: {
                    origin_account: data.origin_account,
                    created_at: { gt: minutesAgo(rules.VELOCITY.window_minutes) },
                },
            })
            : 0,
        // ticket médio só do que foi aprovado
        rules.AMOUNT_ATYPICAL
            ? riskEvaluationRepository.avg("amount", {
                where: {
                    origin_account: data.origin_account,
                    decision: "APPROVE",
                    created_at: { gt: daysAgo(rules.AMOUNT_ATYPICAL.avg_window_days) },
                },
            })
            : null,
        riskEvaluationRepository.select({
            columns: ["id"],
            where: { origin_account: data.origin_account, dest_key: data.dest_key, decision: "APPROVE" },
        }),
        accountProjectionRepository.select({
            columns: ["created_at"],
            where: { account_id: data.origin_account },
        }),
    ]);

    return {
        velocity_count,
        avg_ticket,
        dest_seen_before: seenRows.length > 0,
        account_age_hours: account ? (now - account.created_at.getTime()) / (60 * 60 * 1000) : null,
    };
};

/** @returns {EvaluateResponse} */
const toResponse = (row) => ({
    decision: row.decision,
    score: row.score,
    rule_version: row.rule_version,
    reasons: row.reasons,
});

/**
 * Avalia o risco de uma transação.
 * @param {EvaluateDTO} dto
 * @returns {Promise<EvaluateResponse>}
 */
const evaluate = async (dto) => {
    const data = evaluateSchema.parse(dto);

    // idempotência: mesma tx_id devolve a decisão já tomada
    const [existing] = await riskEvaluationRepository.select({ where: { tx_id: data.tx_id } });
    if (existing) return toResponse(existing);

    const version = process.env.ACTIVE_RULE_VERSION;
    
    const [ruleSet] = await ruleSetRepository.select({ where: { version } });

    if (!ruleSet) throw new Error(`rule set not found: ${version}`);

    const { thresholds, hard_rules, rules } = ruleSet;

    // TODO: DEST_FLAGGED_DICT e ORIGIN_BLOCKED dependem de projeções ainda não existentes
    const blockedBy = riskRules.nightLimit(hard_rules.NIGHT_LIMIT, data);

    let features = {};
    let score;
    let decision;
    let reasons;

    if (blockedBy) {
        score = MAX_SCORE;
        decision = "DENY";
        reasons = [`${blockedBy}:DENY`];
    } else {
        features = await loadFeatures(data, rules);

        const hits = [
            riskRules.destNew(rules.DEST_NEW, data, features),
            riskRules.accountNew(rules.ACCOUNT_NEW, data, features),
            riskRules.velocity(rules.VELOCITY, data, features),
            riskRules.amountAtypical(rules.AMOUNT_ATYPICAL, data, features),
        ].filter(Boolean);

        score = Math.min(MAX_SCORE, hits.reduce((sum, h) => sum + h.points, 0));
        reasons = hits.map((h) => `${h.code}:+${h.points}`);
        switch (true) {
            case score >= thresholds.deny:
                decision = "DENY";
                break;
            case score >= thresholds.review:
                decision = "REVIEW";
                break;
            default:
                decision = "APPROVE";
        }
    }

    try {
        const row = await riskEvaluationRepository.insert({
            tx_id: data.tx_id,
            origin_account: data.origin_account,
            dest_key: data.dest_key,
            amount: data.amount,
            channel: data.channel,
            score,
            decision,
            reasons,
            rule_version: ruleSet.version,
            features_snapshot: features,
        });
        return toResponse(row);
    } catch (err) {
        // corrida com mesma tx_id: outra avaliação gravou primeiro, vale a dela
        if (err.code !== "23505") throw err;
        const [winner] = await riskEvaluationRepository.select({ where: { tx_id: data.tx_id } });
        return toResponse(winner);
    }
};

module.exports = { evaluate };
