require("dotenv").config();
require("./server")

const amqp = require('amqplib');
const { updateAccountBalance } = require("./src/usecases/updateAccountBalance");
const { outboxRelay } = require("./src/outboxRelay");

async function amqpConsumer() {

    const conn = await amqp.connect(process.env.AMQP_URL);
    const ch = await conn.createChannel();

    const exchange = 'ledger.balance';
    const queue = 'accounts.balance-projection';
    const dlx = 'accounts.dlx';
    const dlq = `${queue}.dlq`;

    // nack sem requeue cai na DLQ; sem consumer, fica retida pra inspeção
    await ch.assertExchange(dlx, 'direct', { durable: true });
    await ch.assertQueue(dlq, { durable: true });
    await ch.bindQueue(dlq, dlx, queue);

    await ch.assertExchange(exchange, 'topic', { durable: true });
    await ch.assertQueue(queue, {
        durable: true,
        arguments: { 'x-dead-letter-exchange': dlx, 'x-dead-letter-routing-key': queue },
    });
    await ch.bindQueue(queue, exchange, 'balance.*');

    await ch.consume(queue, async (msg) => {
        if (!msg) return;

        try {
            const payload = JSON.parse(msg.content.toString());
            await updateAccountBalance(payload);
            ch.ack(msg);
        } catch (err) {
            ch.nack(msg, false, false);
        }
    }, { noAck: false });
}


async function run () {
    await amqpConsumer();
    await outboxRelay();
}

run().then((r) => console.log(r)).catch(e => console.log(e));
