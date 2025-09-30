import { loadSchema, pascalCase } from "./utils.js";
import * as fs from "fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
function validateData(ymlPath, dataPath) {
    const doc = loadSchema(ymlPath);
    const input = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    for (const [routePath, pathItem] of Object.entries(doc.paths || {})) {
        for (const [method, operation] of Object.entries(pathItem)) {
            const opId = operation.operationId || pascalCase(`${method}_${routePath}`);
            // --- Body ---
            const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
            if (bodySchema && input.body) {
                const validate = ajv.compile(bodySchema);
                const valid = validate(input.body);
                console.log(`🔎 Validate Body: ${opId}`);
                if (!valid) {
                    console.error("❌ Body Errors:", validate.errors);
                }
                else {
                    console.log("✅ Body is valid");
                }
            }
            // --- Headers ---
            const headers = (operation.parameters || []).filter((p) => p.in === "header");
            if (headers.length > 0 && input.headers) {
                const headerSchema = {
                    type: "object",
                    properties: {},
                    required: [],
                };
                for (const h of headers) {
                    headerSchema.properties[h.name] = h.schema || { type: "string" };
                    if (h.required)
                        headerSchema.required.push(h.name);
                }
                const validate = ajv.compile(headerSchema);
                const valid = validate(input.headers);
                console.log(`🔎 Validate Headers: ${opId}`);
                if (!valid) {
                    console.error("❌ Header Errors:", validate.errors);
                }
                else {
                    console.log("✅ Headers are valid");
                }
            }
        }
    }
}
// CLI usage
const [, , ymlPath, dataPath] = process.argv;
if (!ymlPath || !dataPath) {
    console.error("Usage: npm run validate -- <schema.yml> <data.json>");
    process.exit(1);
}
validateData(ymlPath, dataPath);
