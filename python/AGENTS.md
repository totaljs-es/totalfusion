# AGENTS.md: the Python runtime

The Python side of TotalFusion: the worker that runs the components of an application (`worker.py`), the decorators that declare their contracts (`sdk/totalfusion.py`) and the adapter that starts it from Node.js (`index.js`). The rest of the project is in `../AGENTS.md`.

## Rules of this runtime

- **The worker uses only the standard library**, and works from Python 3.9. A library is the user's.
- **The contracts are read as text.** `fusion.describe()` and the `doctor` parse the components with `ast` and never import them: a module that loads a model on import must not run to be described.
- **Components load from their source, never from bytecode** (`FreshLoader` in `worker.py`): a file saved twice in the same second with the same size would otherwise keep running the old code. Nothing is written to `__pycache__` next to the user's files.
- **The standard output carries the protocol.** The worker points `print` to the error output and, on Windows, sets the descriptors to binary mode.
- **Only a `ValueError` reaches the client** with its message (a mistake of the caller); any other exception answers "The action failed" and goes to the log.
- **A function that yields is a stream** and is not an action. `async def` functions are cancelled for real; a `def` function cannot be interrupted, and the worker is killed after `cancelGrace`.
- `pip-names.json` maps the name of an import to the name of its package (`sklearn` is `scikit-learn`) for the hints of the `doctor` and of the errors.

## Check a change

```bash
env -u PYTHONDONTWRITEBYTECODE node --test tests/python.test.js tests/stale.test.js tests/contract.test.js tests/doctor.test.js
```

Run the tests with `PYTHONDONTWRITEBYTECODE` unset: some environments set it, and then the bugs of stale bytecode cannot show. The components of the tests are in `../tests/components`. The NumPy tests run when `TOTALFUSION_TEST_NUMPY` points to a Python that has NumPy.
