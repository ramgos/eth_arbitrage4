const winston = require('winston');
const moment = require('moment');

const logger = () => {

    const timeFormat = moment().format('YYYY-MM-DD-HH-mm-ss');
    const infoName = `./logs/${timeFormat}-info.log`;
    const errorName = `./logs/${timeFormat}-errors.log`;    

    return winston.createLogger({
        format: winston.format.combine(
            winston.format.errors({stack: true}),
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [
            new winston.transports.File({
                filename: infoName,
                level: 'info'
            }),
            new winston.transports.File({
                filename: errorName,
                level: 'warn'
            }),
            new winston.transports.Console({
                level: 'info'
            })
        ]
    });
}


module.exports = {logger: logger()};