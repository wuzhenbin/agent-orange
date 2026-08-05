export const pythonProgramInstructions = (python_path: string = "") => `
## Python Execution Environment

Whenever Python execution is required::
- Always switch to the Python workspace first:
cd ${python_path}
- Execute all Python commands from this directory.
- Use uv run to execute Python scripts
- If a dependency is missing, install it with:
uv add <package_name>
- Never use pip install. Always prefer uv
`
