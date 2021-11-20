## Update Notes

I've did a lot of progress in one day and it won't fit all in a git commit message:

- change gascalculator.js to use promises instead of callbacks
- discard GasPriceProvider class in favor for a 'Gas Price Clock'
- breakdown the callback hell in index.js by switching to async await syntax
- fix contract issue such that it is possible to use any token as base + use block number instead of block timestamp for deadline (previous commit)
- no more 'primaryToken' bullshit
- no more cacheing of token pairs reserve data (code didn't account for all liquidty events and it caused bloat and memory issues)
- removed cancelling of transactions for now since I couldn't get it to work even on the previous version

goals for near future: 

- update tokens.json every unit of time (plus restart program every unit of time in order to update tokens.json there as well)
- log pure transaction details onto SQL table (doubleSwap params, reserve and dex data, blocknumber, nonce)

goals for mid-near future: 

- add cancelation of transactions
- create log inspection tools

Sadly, I won't have anymore time to work on this project this week

I'm kind of proud of myself but still feel shit
I got no friends to vent to about this so you'll do, git commit logs :))