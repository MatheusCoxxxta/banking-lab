require("dotenv").config();
require("./server")

const amqp = require('amqplib');
const { updateAccountBalance } = require("./src/usecases/updateAccountBalance");

async function amqpConsumer() {

    const conn = await amqp.connect(process.env.AMQP_URL);
    const ch = await conn.createChannel();

    const exchange = 'ledger.balance';
    const queue = 'accounts.balance-projection';

    await ch.assertExchange(exchange, 'topic', { durable: true });
    await ch.assertQueue(queue, { durable: true });
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
}

run().then((r) => console.log(r)).catch(e => console.log(e));
