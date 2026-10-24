# Development and diagnosis

Two things make the daily work easier: the workers are replaced when you change the code, and one command tells you what is wrong with the environment.

## Development: reload when the code changes

```js
fusion.watch('python');   // replaces the workers when a .py file changes
fusion.watch('rust');     // ... when the worker is built again (cargo build)
fusion.watch('go');       // ... when the worker is built again (go build)
fusion.watch('wasm');     // ... when the .wasm file is built again

// Total.js: the same, and the contracts are read again, so a new, changed or removed function is an action without restarting
await fusion.register({ python: { path: PATH.root('python') }, watch: DEBUG });
```

Save a file and the next call runs the new code. The new workers start first and the old ones leave when they are idle, so **no call is lost** while you edit. Options of `fusion.watch(runtime, options)`: `debounce` (milliseconds of quiet after the last change, default 200), `log` (a line in the console for every reload, default true) and `onreload({ runtime, files, replaced })`. It returns `{ close() }`, and `fusion.shutdown()` closes every watcher.

- **What counts.** Python: the `.py` files of the components (not hidden folders, `__pycache__` or `node_modules`). Rust and Go: the binary. WebAssembly: the `.wasm` file. Many writes in a row are one reload.
- **Changes are checked, not trusted.** The events of the system are only a hint (macOS repeats the recent ones, and an editor can save twice): the files are compared with how they were, so a save that changes nothing does not reload.
- **A mistake does not take the application down.** A Python file with a syntax error makes the calls to that module fail with `SyntaxError` while the rest keeps working, and fixing it recovers. If a new worker cannot start (for example a `preload` module with an error) the old one keeps serving and a warning says so; the next edit tries again at once.
- **In Total.js** an error in a file removes no action until it is fixed, and `onreload` of `register` receives the `errors`. A new module with `@startup` or a change in `preload` needs a restart of the application.
- **Only for development.** Use `watch: DEBUG` (or `false` in production): it keeps a watcher on your code and replaces workers.

## Checking your setup

Before running anything, ask TotalFusion what is wrong:

```bash
npx totalfusion doctor --path ./python --venv ./.venv
```

```
TotalFusion doctor: python

[ok]    Interpreter  Python 3.12.15 (/project/.venv/bin/python, chosen by the venv option)
[ok]    Environment  Virtual environment /project/.venv
[ok]    Components   3 modules in /project/python, 2 actions (1 streaming)
[error] Libraries    Not installed: sklearn (pip: scikit-learn) used by classifier; torch used by sentiment
                     Fix: /project/.venv/bin/python -m pip install scikit-learn torch

1 problem to fix
```

The same from code: `const report = await fusion.doctor('python')` gives `report.ok`, `report.checks` (each with `status`, `name`, `message` and, when there is something to do, `fix`) and `report.text`. The command exits with `0` when everything is in order (warnings are advice), `1` when something has to be fixed and `2` for a wrong usage; `--json` prints the report as JSON. Options: `--runtime python|rust|go|wasm`, `--path`, `--venv`, `--python`, `--requirements`, `--preload a,b`, `--binary` (Rust and Go: with Go, say `--runtime go` too), `--module` (WebAssembly) and `--max-memory 2gb`.

It looks at the interpreter (version, where it was chosen from, virtual environment or system Python), the components (syntax errors, contracts that cannot be read, `preload` modules that do not exist), the libraries they import and `requirements.txt`. **Nothing is imported, run or installed**: the components are read as text, so a module that loads a model on import is no problem. Imports inside functions are found too, and an import guarded by `try/except ImportError` is only a warning. The libraries are looked up with the same interpreter that will run the workers, which is the point: installing a library in another Python is the most common mistake. For `requirements.txt` (next to the components, in the folder above, or the `requirements` option) it checks what is installed and the version specifiers (`==`, `>=`, `<`, ...); lines with environment markers, URLs and options such as `-r` are not checked.

The same hint reaches the errors at run time. A call that fails with `ModuleNotFoundError`, or a worker that cannot start because of a missing library, carries `err.hint` (and it is appended to the stack): `"numpy" is not installed in the Python that runs the workers (/project/.venv/bin/python). Install it with: /project/.venv/bin/python -m pip install numpy`. Names that differ from the package (`sklearn` is `scikit-learn`, `cv2` is `opencv-python`, `PIL` is `Pillow`, ...) are translated.

## Running the tests of the project

See [CONTRIBUTING.md](../CONTRIBUTING.md).
