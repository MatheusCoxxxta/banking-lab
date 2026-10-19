require("dotenv").config();
require("./server");

const amqp = require("amqplib");
const { createAccountProjection } = require("./src/usecases/createAccountProjection");

async function amqpConsumer() {

    const conn = await amqp.connect(process.env.AMQP_URL);
    const ch = await conn.createChannel();

    const exchange = "accounts.account";
    const queue = "antifraud.account-projection";
    const dlx = "antifraud.dlx";
    const dlq = `${queue}.dlq`;

    // nack sem requeue cai na DLQ; sem consumer, fica retida pra inspeção
    await ch.assertExchange(dlx, "direct", { durable: true });
    await ch.assertQueue(dlq, { durable: true });
    await ch.bindQueue(dlq, dlx, queue);

    await ch.assertExchange(exchange, "topic", { durable: true });
    await ch.assertQueue(queue, {
        durable: true,
        arguments: { "x-dead-letter-exchange": dlx, "x-dead-letter-routing-key": queue },
    });
    await ch.bindQueue(queue, exchange, "account.created");

    await ch.consume(queue, async (msg) => {
        if (!msg) return;

        try {
            const payload = JSON.parse(msg.content.toString());
            await createAccountProjection(payload);
            ch.ack(msg);
        } catch (err) {
            console.error(err);
            ch.nack(msg, false, false);
        }
    }, { noAck: false });
}

async function run () {
    await amqpConsumer();
}

run().then((r) => console.log(r)).catch(e => console.log(e));
