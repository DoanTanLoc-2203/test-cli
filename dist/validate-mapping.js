#!/usr/bin/env ts-node
import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
/** Lấy value theo path như "orders[0].items[1].sku" hoặc "orders.length" */
function getValueByPath(obj, pathStr) {
    if (!obj || !pathStr)
        return undefined;
    if (pathStr.endsWith(".length")) {
        const basePath = pathStr.replace(/\.length$/, "");
        const val = getValueByPath(obj, basePath);
        return Array.isArray(val) ? val.length : undefined;
    }
    const parts = pathStr.split(".");
    let cur = obj;
    for (const part of parts) {
        if (part === "")
            continue;
        const m = part.match(/^([^\[]+)\[(\d+)\]$/); // e.g. orders[0]
        if (m) {
            const key = m[1];
            const idx = parseInt(m[2], 10);
            cur = cur?.[key]?.[idx];
        }
        else {
            cur = cur?.[part];
        }
        if (cur === undefined)
            return undefined;
    }
    return cur;
}
/** Tìm path gốc chứa leftmost "[]", ví dụ template "user.orders[].items[].sku" -> "user.orders" */
function findLeftmostArrayRoot(template) {
    if (typeof template === "string") {
        const pos = template.indexOf("[]");
        if (pos !== -1) {
            // lấy substring trước "[]", xóa dot nếu có cuối cùng
            let s = template.slice(0, pos);
            if (s.endsWith("."))
                s = s.slice(0, -1);
            return s;
        }
        return null;
    }
    if (Array.isArray(template)) {
        for (const it of template) {
            const r = findLeftmostArrayRoot(it);
            if (r)
                return r;
        }
    }
    else if (typeof template === "object" && template !== null) {
        for (const v of Object.values(template)) {
            const r = findLeftmostArrayRoot(v);
            if (r)
                return r;
        }
    }
    return null;
}
/** Thay thế **chỉ 1 lần** placeholder "[]" trong tất cả các string của template (deep clone) */
function replaceFirstPlaceholderDeep(template, index) {
    if (typeof template === "string") {
        // chỉ thay lần đầu xuất hiện của "[]"
        return template.replace(/\[\]/, `[${index}]`);
    }
    else if (Array.isArray(template)) {
        return template.map((it) => replaceFirstPlaceholderDeep(it, index));
    }
    else if (typeof template === "object" && template !== null) {
        const o = {};
        for (const [k, v] of Object.entries(template)) {
            o[k] = replaceFirstPlaceholderDeep(v, index);
        }
        return o;
    }
    return template;
}
/** So sánh mềm để tránh mismatch "100" vs 100 trừ khi bạn muốn strict */
function looselyEqual(a, b) {
    if (a === undefined || a === null)
        return b === undefined || b === null;
    if (typeof a === "number" && typeof b === "string")
        return a == +b;
    if (typeof a === "string" && typeof b === "number")
        return +a == b;
    if (Array.isArray(a) && Array.isArray(b))
        return true;
    if (typeof a === "object" && typeof b === "object")
        return true;
    return a === b;
}
/**
 * Core validator
 * - source: object1
 * - target: object2
 * - mapTemplate: mapping node (string | object | [templateObject])
 * - basePath: path at target we're validating (eg "orders[0].code")
 */
function validateMapping(source, target, mapTemplate, basePath = "") {
    const res = [];
    // case: leaf mapping string -> interpret as source path
    if (typeof mapTemplate === "string") {
        // remove any remaining placeholders (should have been replaced by parents)
        const sourcePath = mapTemplate
            .replace(/\[\]/g, "")
            .replace(/\.\./g, ".")
            .replace(/^\./, "");
        const expected = getValueByPath(source, sourcePath);
        const actual = getValueByPath(target, basePath);
        const ok = looselyEqual(expected, actual);
        res.push({
            path: basePath,
            ok,
            expected,
            actual,
            message: ok
                ? `✔ ${basePath} = ${JSON.stringify(actual)}`
                : `❌ Mismatch at "${basePath}" → expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        });
        return res;
    }
    // case: mapping is an array template -> means target at basePath should be an array
    if (Array.isArray(mapTemplate)) {
        const template = mapTemplate[0];
        const root = findLeftmostArrayRoot(template);
        if (!root) {
            // no [] found in template: treat as array of primitive/object mapped by index keys
            const srcArr = getValueByPath(source, basePath) ?? [];
            const tgtArr = getValueByPath(target, basePath) ?? [];
            if (!Array.isArray(srcArr) || !Array.isArray(tgtArr)) {
                res.push({
                    path: basePath,
                    ok: false,
                    expected: Array.isArray(srcArr) ? "array" : typeof srcArr,
                    actual: Array.isArray(tgtArr) ? "array" : typeof tgtArr,
                    message: `❌ Expected array at "${basePath}"`,
                });
                return res;
            }
            const len = Math.min(srcArr.length, tgtArr.length);
            for (let i = 0; i < len; i++) {
                res.push(...validateMapping(source, target, template, `${basePath}[${i}]`));
            }
            return res;
        }
        // root like "orders" or "user.orders"
        const sourceArr = getValueByPath(source, root) ?? [];
        const targetArr = getValueByPath(target, basePath) ?? [];
        if (!Array.isArray(sourceArr)) {
            res.push({
                path: basePath,
                ok: false,
                expected: "array",
                actual: typeof sourceArr,
                message: `❌ Expected array at source path "${root}", got ${typeof sourceArr}`,
            });
            return res;
        }
        if (!Array.isArray(targetArr)) {
            res.push({
                path: basePath,
                ok: false,
                expected: "array",
                actual: typeof targetArr,
                message: `❌ Expected array at target "${basePath}", got ${typeof targetArr}`,
            });
            return res;
        }
        // require equal lengths (you can change to min if you want permissive)
        if (sourceArr.length !== targetArr.length) {
            res.push({
                path: basePath,
                ok: false,
                expected: sourceArr.length,
                actual: targetArr.length,
                message: `❌ Array length mismatch at "${basePath}" → expected ${sourceArr.length}, got ${targetArr.length}`,
            });
            return res;
        }
        // iterate and replace only the leftmost [] (per-field) with current index
        for (let i = 0; i < sourceArr.length; i++) {
            const replaced = replaceFirstPlaceholderDeep(template, i); // replaces first [] occurrences to [i]
            res.push(...validateMapping(source, target, replaced, `${basePath}[${i}]`));
        }
        return res;
    }
    // case: object -> dive into keys
    if (typeof mapTemplate === "object" && mapTemplate !== null) {
        for (const [key, val] of Object.entries(mapTemplate)) {
            const nextBase = basePath ? `${basePath}.${key}` : key;
            res.push(...validateMapping(source, target, val, nextBase));
        }
    }
    return res;
}
/** CLI */
async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option("source", { type: "string", demandOption: true })
        .option("target", { type: "string", demandOption: true })
        .option("mapping", { type: "string", demandOption: true })
        .parse();
    const readJSON = (p) => JSON.parse(fs.readFileSync(path.resolve(p), "utf8"));
    const source = readJSON(argv.source);
    const target = readJSON(argv.target);
    const mapping = readJSON(argv.mapping);
    console.log("🔍 Validating mapping...\n");
    const results = validateMapping(source, target, mapping);
    const errors = results.filter((r) => !r.ok);
    // print all messages (matches + mismatches)
    for (const r of results)
        console.log(r.message);
    console.log("\n───────────────────────────────");
    if (errors.length === 0) {
        console.log("✅ Mapping is valid!");
        process.exit(0);
    }
    else {
        console.error(`❌ Mapping validation failed with ${errors.length} error(s).`);
        for (const e of errors)
            console.error(` - ${e.message}`);
        process.exit(1);
    }
}
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        const e = err;
        console.error(e?.message ?? err);
        process.exit(1);
    });
}
