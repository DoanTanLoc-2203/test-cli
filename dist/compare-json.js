import * as fs from "fs";
function compareJson(obj1, obj2, path = "") {
    const diffs = [];
    // Keys union
    const allKeys = new Set([
        ...Object.keys(obj1 || {}),
        ...Object.keys(obj2 || {}),
    ]);
    for (const key of allKeys) {
        const val1 = obj1 ? obj1[key] : undefined;
        const val2 = obj2 ? obj2[key] : undefined;
        const currentPath = path ? `${path}.${key}` : key;
        if (val1 === undefined) {
            diffs.push(`🟢 Key missing in first JSON: ${currentPath}, value in second = ${JSON.stringify(val2)}`);
        }
        else if (val2 === undefined) {
            diffs.push(`🔴 Key missing in second JSON: ${currentPath}, value in first = ${JSON.stringify(val1)}`);
        }
        else if (typeof val1 === "object" &&
            val1 !== null &&
            typeof val2 === "object" &&
            val2 !== null) {
            diffs.push(...compareJson(val1, val2, currentPath));
        }
        else if (val1 !== val2) {
            diffs.push(`⚠️ Difference at ${currentPath}: first = ${JSON.stringify(val1)}, second = ${JSON.stringify(val2)}`);
        }
    }
    return diffs;
}
function runCompare(file1, file2) {
    const json1 = JSON.parse(fs.readFileSync(file1, "utf-8"));
    const json2 = JSON.parse(fs.readFileSync(file2, "utf-8"));
    const diffs = compareJson(json1, json2);
    if (diffs.length === 0) {
        console.log("✅ Two JSON files are identical");
    }
    else {
        console.log("❌ Differences found:");
        diffs.forEach((d) => console.log(" - " + d));
    }
}
// CLI
const [, , f1, f2] = process.argv;
if (!f1 || !f2) {
    console.error("Usage: ts-node src/compare-json.ts <file1.json> <file2.json>");
    process.exit(1);
}
runCompare(f1, f2);
