const amqp = require("amqplib");
const outboxRepository = require("./repositories/outboxRepository");

const EXCHANGE = "accounts.account";
const ROUTING_KEY = "account.created";
const POLL_INTERVAL_MS = 100;

// at-least-once: falha entre publish e update de status reenvia; consumer deduplica por messageId
async function outboxRelay() {
    const conn = await amqp.connect(process.env.AMQP_URL);
    // confirm channel: só marca sent depois do broker confirmar recebimento
    const ch = await conn.createConfirmChannel();

    await ch.assertExchange(EXCHANGE, "topic", { durable: true });

    const tick = async () => {
        try {
            const pending = await outboxRepository.findByStatus("pending");

            for (const event of pending) {
                try {
                    await outboxRepository.incrementAttempt(event.id);
                    ch.publish(EXCHANGE, ROUTING_KEY, Buffer.from(JSON.stringify(event.payload)), {
                        contentType: "application/json",
                        persistent: true,
                        messageId: event.id,
                    });
                    await ch.waitForConfirms();
                    await outboxRepository.updateStatus(event.id, "sent");
                } catch (err) {
                    console.error(`outbox event ${event.id}:`, err);
                }
            }
        } catch (err) {
            console.error("outbox relay:", err);
        }

        // agenda só depois de terminar: evita ticks sobrepostos
        setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();
}

module.exports = { outboxRelay };
