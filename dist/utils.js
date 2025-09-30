import * as fs from "fs";
import * as YAML from "yaml";
export function pascalCase(str) {
    return str
        .replace(/[^a-zA-Z0-9]/g, " ")
        .replace(/\w+/g, (w) => w[0].toUpperCase() + w.slice(1))
        .replace(/\s+/g, "");
}
export function loadSchema(filePath) {
    const raw = fs.readFileSync(filePath, "utf-8");
    return filePath.endsWith(".yml") || filePath.endsWith(".yaml")
        ? YAML.parse(raw)
        : JSON.parse(raw);
}
