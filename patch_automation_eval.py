import sys

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

target_matchValue = """function matchValue(op, actual, expected) {
  switch (op) {"""
replacement_matchValue = """function matchValue(op, actual, expected, env) {
  switch (op) {
    case 'exceeds_rate_limit': {
      if (!env || !env.rateLimits) return false;
      const parts = String(expected).split('/');
      const limit = parseInt(parts[0], 10) || 5;
      const seconds = parseInt(parts[1], 10) || 10;
      const key = `${env.apiKey}:${env.ruleId}:${actual}`;
      const now = Date.now();
      let history = env.rateLimits.get(key) || [];
      history = history.filter(t => now - t <= seconds * 1000);
      history.push(now);
      env.rateLimits.set(key, history);
      return history.length >= limit;
    }"""
content = content.replace(target_matchValue, replacement_matchValue)

target_evaluateConditionNode = """function evaluateConditionNode(node, ctx, into) {
  // Group node (nested conditions): recursively evaluate children, combine
  // with its own all/any policy.
  if (!node.field) {
    const children = (node.conditions || []).map(child => evaluateConditionNode(child, ctx, into));
    if (!children.length) return false;
    return node.match === 'any' ? children.some(Boolean) : children.every(Boolean);
  }
  const passed = matchValue(node.op, fieldValue(ctx, node.field), node.value);"""
replacement_evaluateConditionNode = """function evaluateConditionNode(node, ctx, into, env) {
  // Group node (nested conditions): recursively evaluate children, combine
  // with its own all/any policy.
  if (!node.field) {
    const children = (node.conditions || []).map(child => evaluateConditionNode(child, ctx, into, env));
    if (!children.length) return false;
    return node.match === 'any' ? children.some(Boolean) : children.every(Boolean);
  }
  const passed = matchValue(node.op, fieldValue(ctx, node.field), node.value, env);"""
content = content.replace(target_evaluateConditionNode, replacement_evaluateConditionNode)

target_evaluateRule = """function evaluateRule(rule, ctx) {
  const results = [];
  const top = rule.trigger.conditions || [];
  if (top.length && top[0] && !top[0].field) {
    // New tree shape: root of the condition tree.
    const matched = evaluateConditionNode(top[0], ctx, results);
    return { matched, conditions: results };
  }
  const passed = (top).map(condition => {
    const matching = matchValue(condition.op, fieldValue(ctx, condition.field), condition.value);"""
replacement_evaluateRule = """function evaluateRule(rule, ctx, env) {
  const results = [];
  const top = rule.trigger.conditions || [];
  if (top.length && top[0] && !top[0].field) {
    // New tree shape: root of the condition tree.
    const matched = evaluateConditionNode(top[0], ctx, results, env);
    return { matched, conditions: results };
  }
  const passed = (top).map(condition => {
    const matching = matchValue(condition.op, fieldValue(ctx, condition.field), condition.value, env);"""
content = content.replace(target_evaluateRule, replacement_evaluateRule)

with open(path, 'w') as f:
    f.write(content)

print("Patched matchValue, evaluateConditionNode, evaluateRule!")
