"use strict";

(function installImageUrlRules(global) {
  const MAX_VARIANTS = 216;

  function compilePattern(pattern) {
    const placeholderCount = typeof pattern === "string" ? (pattern.match(/%s/g) || []).length : 0;
    if (!placeholderCount || placeholderCount > 6 || pattern.length > 1000) return null;
    const parts = pattern.split(/(\*|%s)/);
    const output = [];
    let expression = "^";
    let capture = 0;
    let replacement = 0;
    for (const part of parts) {
      if (part === "*") {
        expression += "(.*?)";
        output.push({ capture: ++capture });
      } else if (part === "%s") {
        expression += "([^/?#&]+)";
        capture++;
        output.push({ replacement: replacement++ });
      } else if (part) {
        expression += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        output.push({ literal: part });
      }
    }
    try { return { regex: new RegExp(expression + "$", "i"), output, placeholderCount }; }
    catch (_) { return null; }
  }

  function replacementGroups(values, count) {
    if (!Array.isArray(values) || values.length !== count || values.some(group => !Array.isArray(group))) return null;
    const cleaned = values.map(group => Array.isArray(group)
      ? group.filter(value => typeof value === "string" && value.trim() && value.length <= 100).slice(0, 6).map(value => value.trim())
      : []);
    if (cleaned.some(group => !group.length)) return null;
    if (cleaned.reduce((total, group) => total * group.length, 1) > MAX_VARIANTS) return null;
    return cleaned;
  }

  function buildCandidate(compiled, match, groups, indices, original) {
    const candidateText = compiled.output.map(part => {
      if (part.replacement !== undefined) return groups[part.replacement][indices[part.replacement]];
      if (part.capture) return match[part.capture];
      return part.literal;
    }).join("");
    try {
      const candidate = new URL(candidateText);
      if (!/^https?:$/.test(candidate.protocol) || candidate.hostname !== original.hostname) return null;
      return candidate.href;
    } catch (_) { return null; }
  }

  function buildVariants(compiled, match, groups, indices, original, selectedGroup) {
    const variants = [];
    const add = nextIndices => {
      const url = buildCandidate(compiled, match, groups, nextIndices, original);
      if (url && !variants.some(item => item.url === url)) variants.push({ url, indices: nextIndices.slice() });
    };
    add(indices);
    if (!Number.isInteger(selectedGroup)) {
      const nextIndices = indices.slice();
      const visit = groupIndex => {
        if (groupIndex === groups.length) {
          add(nextIndices);
          return;
        }
        for (let valueIndex = 0; valueIndex < groups[groupIndex].length; valueIndex++) {
          nextIndices[groupIndex] = valueIndex;
          visit(groupIndex + 1);
        }
      };
      visit(0);
      return variants;
    }
    for (const groupIndex of [selectedGroup]) {
      for (let offset = 1; offset < groups[groupIndex].length; offset++) {
        const nextIndices = indices.slice();
        nextIndices[groupIndex] = (indices[groupIndex] + offset) % groups[groupIndex].length;
        add(nextIndices);
      }
    }
    return variants;
  }

  function compileRuleState(source, rule) {
    if (!rule || rule.enabled === false || typeof rule.pattern !== "string") return null;
    const compiled = compilePattern(rule.pattern);
    if (!compiled) return null;
    const groups = replacementGroups(rule.values, compiled.placeholderCount);
    if (!groups) return null;
    const match = compiled.regex.exec(source);
    if (!match) return null;
    return { compiled, groups, indices: groups.map(() => 0), match };
  }

  global.WMA_applyImageUrlRules = function applyImageUrlRules(source, rules) {
    if (typeof source !== "string" || !Array.isArray(rules)) return source;
    let original;
    try { original = new URL(source); } catch (_) { return source; }
    if (!/^https?:$/.test(original.protocol)) return source;

    for (const rule of rules) {
      const ruleState = compileRuleState(source, rule);
      if (!ruleState) continue;
      const variants = buildVariants(ruleState.compiled, ruleState.match, ruleState.groups, ruleState.indices, original);
      if (!variants.length) return source;
      const urls = variants.map(item => item.url);
      if (!urls.includes(source)) urls.push(source);
      return {
        urls,
        variants,
        source,
        state: { source, pattern: rule.pattern, groups: ruleState.groups, indices: ruleState.indices }
      };
    }
    return source;
  };

  global.WMA_cycleImageUrlRuleGroup = function cycleImageUrlRuleGroup(state, groupIndex) {
    if (!state || typeof state.source !== "string" || typeof state.pattern !== "string" || !Number.isInteger(groupIndex)) return null;
    let original;
    try { original = new URL(state.source); } catch (_) { return null; }
    const compiled = compilePattern(state.pattern);
    const groups = compiled && replacementGroups(state.groups, compiled.placeholderCount);
    if (!compiled || !groups || groupIndex < 0 || groupIndex >= groups.length) return null;
    const match = compiled.regex.exec(state.source);
    if (!match) return null;
    const indices = groups.map((group, index) => Number.isInteger(state.indices && state.indices[index])
      ? Math.max(0, Math.min(group.length - 1, state.indices[index]))
      : 0);
    indices[groupIndex] = (indices[groupIndex] + 1) % groups[groupIndex].length;
    const variants = buildVariants(compiled, match, groups, indices, original, groupIndex);
    const urls = variants.map(item => item.url);
    if (!urls.includes(state.source)) urls.push(state.source);
    return { urls, variants, state: { source: state.source, pattern: state.pattern, groups, indices } };
  };
})(globalThis);
