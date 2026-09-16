import sys
import re

path = 'server/services/automation.service.js'
with open(path, 'r') as f:
    content = f.read()

content = content.replace("this.stores = new Map(); // apiKeyHash -> { file, rules }", "this.stores = new Map(); // apiKeyHash -> { file, rules }\n    this.rateLimits = new Map();")

content = content.replace("const evalResult = evaluateRule(rule, ctx);", "const evalResult = evaluateRule(rule, ctx, { rateLimits: this.rateLimits, apiKey, ruleId: rule.id });")

target_test_match = """    const result = evaluateRule({ trigger: rule.trigger, action: {} }, ctx);"""
replacement_test_match = """    const result = evaluateRule({ trigger: rule.trigger, action: {} }, ctx, { rateLimits: this.rateLimits, apiKey, ruleId: rule.id });"""
content = content.replace(target_test_match, replacement_test_match)

with open(path, 'w') as f:
    f.write(content)

print("Patched automation service calls!")
