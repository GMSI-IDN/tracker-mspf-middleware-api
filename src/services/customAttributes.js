const { evaluate } = require('mathjs');
const set = require('lodash/set');
const unset = require('lodash/unset');
const db = require('../db');
const config = require('../config');

let deviceRulesCache = {};
let cacheBuilt = 0;

async function buildDeviceRulesCache() {
  try {
    const manualGroups = await db('device_groups').select('device_id', 'source', 'group_id');
    const rules = await db('custom_attribute_rules').where({ enabled: true }).orderBy('priority');
    const syncRules = await db('group_sync_rules').select('middleware_group_id', 'source', 'source_group_id');

    deviceRulesCache = {};

    function addRuleToDevice(key, rule) {
      if (!deviceRulesCache[key]) deviceRulesCache[key] = [];
      if (!deviceRulesCache[key].some(r => r.name === rule.name)) {
        deviceRulesCache[key].push(rule);
      }
    }

    // A. Manual additions
    for (const dg of manualGroups) {
      const key = `${dg.source}:${dg.device_id}`;
      const matchingRules = rules.filter(r => r.group_id === dg.group_id);
      for (const r of matchingRules) addRuleToDevice(key, r);
    }

    // B. Dynamic sync rules
    if (syncRules.length > 0) {
      const cache = require('./cache');
      const allDevices = cache.get('devices:merged') || [];
      const { deviceMatchesSyncRule } = require('./groupMembership');
      for (const d of allDevices) {
        const key = `${d.source}:${d.id}`;
        for (const sRule of syncRules) {
          if (deviceMatchesSyncRule(d, sRule)) {
            const matchingRules = rules.filter(r => r.group_id === sRule.middleware_group_id);
            for (const r of matchingRules) addRuleToDevice(key, r);
          }
        }
      }
    }

    cacheBuilt = Date.now();
  } catch {}
}

async function getDeviceRules(deviceId, source) {
  if (!cacheBuilt || Date.now() - cacheBuilt > (config.cache.ttl || 120) * 1000) {
    await buildDeviceRulesCache();
  }
  const key = `${source}:${deviceId}`;
  return deviceRulesCache[key] || [];
}

function getField(device, path) {
  if (!path) return undefined;
  let val = device[path];
  if (val === undefined) val = device.attributes?.[path];
  if (val === undefined && path.includes('.')) {
    val = path.split('.').reduce((obj, key) => obj?.[key], device.attributes);
  }
  return val;
}

function computeFormula(expression, value, attrs) {
  if (!expression) return value;
  try {
    const scope = { value, attrs, ...(typeof attrs === 'object' && attrs ? attrs : {}) };
    return evaluate(expression, scope);
  } catch {
    return null;
  }
}

function applyRules(device, rules) {
  if (!rules || rules.length === 0) return device;
  if (!device.attributes) device.attributes = {};

  const allowedKeys = [];
  const seenNames = new Set();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const raw = rule.source_field ? getField(device, rule.source_field) : undefined;
    const val = getField(device, rule.source_field || rule.name);

    if (rule.mode === 'passthrough') {
      if (val !== undefined && !seenNames.has(rule.name)) {
        allowedKeys.push(rule.name);
        seenNames.add(rule.name);
      }
    } else if (rule.mode === 'rename') {
      if (val !== undefined) {
        device.attributes[rule.name] = val;
        allowedKeys.push(rule.name);
        seenNames.add(rule.name);
      }
    } else if (rule.mode === 'compute') {
      const result = computeFormula(rule.formula, raw, device.attributes);
      if (result !== null) {
        device.attributes[rule.name] = result;
        allowedKeys.push(rule.name);
        seenNames.add(rule.name);
      }
    }
  }

  if (device.attributes && allowedKeys.length > 0) {
    for (const key of Object.keys(device.attributes)) {
      if (!seenNames.has(key)) {
        delete device.attributes[key];
      }
    }
  }

  return device;
}

function enrichWithRules(device, rules) {
  if (!rules || rules.length === 0 || !device.attributes) return device;
  for (const rule of rules) {
    if (rule.mode === 'passthrough' || rule.mode === 'rename') {
      const val = getField(device, rule.source_field);
      if (val !== undefined) device.attributes[rule.name] = val;
    } else if (rule.mode === 'compute' && rule.formula) {
      const raw = rule.source_field ? getField(device, rule.source_field) : undefined;
      const result = computeFormula(rule.formula, raw, device.attributes);
      if (result !== null) device.attributes[rule.name] = result;
    }
  }
  return device;
}

module.exports = { applyRules, computeFormula, getDeviceRules, buildDeviceRulesCache, enrichWithRules };
