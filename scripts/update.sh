#!/bin/bash

cd ./eth_arbitrage4
mv logs/* ../hislogs/
date=$(date +"%Y-%m-%d-%H-%M-%S")
dbloc="../dbbackups/dbbackup-${date}.db"
mv txnindex.db $dbloc
git reset --hard
git pull origin master
npm install