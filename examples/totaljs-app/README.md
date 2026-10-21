# A Total.js 5 application with Python

```bash
npm install
npm start
```

Then, from another terminal:

```bash
# an action called through an API route (Total.js validates the input with the contract of the Python function)
curl -s -X POST localhost:8000/api/ -H 'content-type: application/json' -d '{"schema":"words_analyze","data":{"text":"TotalFusion runs Python from Total.js"}}'

# the same call without the text: Total.js answers before Python is reached
curl -s -X POST localhost:8000/api/ -H 'content-type: application/json' -d '{"schema":"words_analyze","data":{}}'

# a Python generator as Server-Sent Events, one event every 0.4 s
curl -N localhost:8000/countdown/?from=5
```

Edit `python/words.py` while the application runs (for example change what `analyze` returns) and call it again: the workers are replaced and the next request uses the new code.

To expose the actions that say `mcp=True` to AI agents, set `$mcp : true` in `config`. That endpoint has no authentication unless you add one, so do it only on a machine you control.

Check the setup at any time with `npx totalfusion doctor --path python`.
