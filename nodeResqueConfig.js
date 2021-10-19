const connectionDetails = {
    pkg: "ioredis",
    host: "127.0.0.1",
    password: null,
    port: 6379,
    database: 0,
};

const queueName = 'arbitrage';

module.exports = {
    connectionDetails,
    queueName,
}