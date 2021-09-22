const {Worker} = require('node-resque');

const {connectionDetails, jobs, queueName} = require('./nodeResqueConfig.js');

const Main = async () => {
    const worker = new Worker(
        { connection: connectionDetails, queues: [queueName] },
        jobs
    );

    await worker.connect();
    worker.start();

    worker.on("job", (queue, job) => {
        console.log(job);
    })
    worker.on("failure", (queue, job, failure, duration) => {
        console.log(failure);
    })
    worker.on("error", (error) => {
        console.log(error);
    })
}

Main();