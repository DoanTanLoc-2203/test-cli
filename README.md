Setup

```bash
npm install
```

```bash
npm run build
```

Run validate input using schema

```bash
npm run validate examples/schema01.yml examples/schema01-data.json
```

Run compare json

```bash
npm run compare-json examples/file1.json examples/file2.json
```

Run validate mapping

```bash
npm run validate-mapping -- --source examples/mapping/input.json  --target examples/mapping/output.json --mapping examples/mapping/mapping-config.json
```

Run export from mapping config

```bash
npm run validate-mapping -- --source examples/mapping/input.json --mapping examples/mapping/mapping-config.json --export --output examples/mapping/generated.json
```
