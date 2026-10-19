// regras puras: recebem dados já resolvidos, sem acesso a banco

const TIMEZONE = "America/Sao_Paulo";

const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

const localMinutes = (date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return get("hour") * 60 + get("minute");
};

// janela pode cruzar meia-noite (22:00–06:00)
const isWithinWindow = (date, start, end) => {
    const t = localMinutes(date);
    const s = toMinutes(start);
    const e = toMinutes(end);
    return s <= e ? t >= s && t < e : t >= s || t < e;
};

// tiers avaliados do mais severo pro mais leve; só o primeiro que casar pontua
const firstTier = (tiers, matches) =>
    [...tiers].sort((a, b) => b.points - a.points).find(matches);

/** @returns {string | null} código da hard rule que bloqueou */
const nightLimit = (config, { amount, created_at }) => {
    if (!config?.enabled) return null;
    if (!isWithinWindow(created_at, config.start, config.end)) return null;
    return amount > config.max_amount ? "NIGHT_LIMIT" : null;
};

/** @returns {{ code: string, points: number } | null} */
const destNew = (config, { amount }, { dest_seen_before }) => {
    if (!config) return null;
    if (dest_seen_before || amount < config.min_amount) return null;
    return { code: "DEST_NEW", points: config.points };
};

// projeção ausente = conta tão nova que o evento ainda não chegou: trata como nova
/** @returns {{ code: string, points: number } | null} */
const accountNew = (config, _data, { account_age_hours }) => {
    if (!config) return null;
    if (account_age_hours !== null && account_age_hours >= config.max_age_hours) return null;
    return { code: "ACCOUNT_NEW", points: config.points };
};

// velocity_count conta só as anteriores; +1 inclui a transação atual
/** @returns {{ code: string, points: number } | null} */
const velocity = (config, _data, { velocity_count }) => {
    if (!config) return null;
    const tier = firstTier(config.tiers, (t) => velocity_count + 1 >= t.min_tx);
    return tier ? { code: `VELOCITY_${tier.min_tx}TX`, points: tier.points } : null;
};

// sem histórico (avg null) não pontua: conta nova cai em ACCOUNT_NEW
/** @returns {{ code: string, points: number } | null} */
const amountAtypical = (config, { amount }, { avg_ticket }) => {
    if (!config || avg_ticket === null) return null;
    const tier = firstTier(config.tiers, (t) => amount > avg_ticket * t.multiplier);
    return tier ? { code: `AMOUNT_${tier.multiplier}X_AVG`, points: tier.points } : null;
};

module.exports = { nightLimit, destNew, accountNew, velocity, amountAtypical };
