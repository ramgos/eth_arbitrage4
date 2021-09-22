const connectionDetails = {
    pkg: "ioredis",
    host: "127.0.0.1",
    password: null,
    port: 6379,
    database: 0,
};

const jobs = {
    arb: {
        perform: async ({
            amount,
            token0,
            token1,
            pairAddress0,
            pairAddress0Hash,
            pairAddress1,
            pairAddress1Hash,
            router0,
            router1,
            dexName0,
            dexName1
        }) => {return 0}
    }
}

const queueName = 'arbitrage';

module.exports = {
    connectionDetails,
    queueName,
    jobs,
}