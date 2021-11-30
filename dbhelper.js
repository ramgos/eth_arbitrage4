const { logger } = require('./logger.js');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('txnindex.db', (error) => {
    if (error) {
        logger.error(error, {meta: {msg: 'dbhelper.js: could not connect to database'}});
        return;
    }
    logger.info('dbhelper.js: connected to transaction database');
});


const logtxn = ({hash, timestart, blocknumber, nonce, call, reserve}) => {
    const sql = 
    `
        INSERT INTO 
        txn(hash, timestart, blocknumber, nonce, call, reserve) 
        VALUES 
        (?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [hash, timestart, blocknumber, nonce, call, reserve], (error) => {
        if (error) {
            logger.error(error, {meta: {msg: 'dbhelper.js: txn insert failed'}});
            return;
        }
        logger.info(`dbhelper.js: txn indexed succesfully: ${hash}`);
    });
}


const cleantxnTable = () => {
    db.run('DELETE FROM txn', (error) => {
        if (error) {
            logger.error(error, {meta: {msg: 'dbhelper.js: txn table clean failed'}});
            return;
        }
        logger.warn(`dbhelper.js: txn table cleaned!`);
    });
}


const createtxnTable = () => {
    db.run(
        `CREATE TABLE 
        txn(hash TEXT PRIMARY KEY, 
            time TIMESTAMP default CURRENT_TIMESTAMP, 
            timestart BIGINT, 
            blocknumber INT, 
            nonce INT, 
            call TEXT, 
            reserve TEXT)`
    , (error) => {
        if (error) {
            logger.error(error, {meta: {msg: 'dbhelper.js: creation of txn table failed'}});
            return;
        }
        logger.info('dbhelper.js: created txn table');
    });
}


module.exports = {
    logtxn,
    cleantxnTable,
    createtxnTable
}