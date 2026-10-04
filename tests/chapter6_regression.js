const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scripts = path.join(__dirname, '../assets/scripts');
const flags = ['vigil_recruited', 'cobb_recruited', 'vex_recruited', 'nettle_recruited'];

function chapter(number, globals) {
    const local = {}, dialogue = [], loaded = [];
    const methods = {
        getVar: (key, fallback) => local[key] ?? fallback,
        setVar: (key, value) => { local[key] = value; },
        getGlobalVar: (key, fallback) => globals[key] ?? fallback,
        setGlobalVar: (key, value) => { globals[key] = value; },
        say: (speaker, text) => { dialogue.push([speaker, text]); return {}; },
        wait: () => ({}),
        loadLevel: name => { loaded.push(name); },
    };
    const api = new Proxy(methods, {get: (target, key) => target[key] ?? (() => undefined)});
    const context = vm.createContext({api, Math});
    vm.runInContext(fs.readFileSync(path.join(scripts, `chapter${number}.js`), 'utf8'), context);
    return {
        local, dialogue, loaded,
        call(name, ...args) {
            const iterator = context[name](...args);
            if (iterator?.next) {
                let steps = 0;
                while (!iterator.next().done) assert.ok(++steps < 1000, 'bounded quest sequence');
            }
        },
    };
}

for (let mask = 0; mask < 16; ++mask) {
    const globals = Object.fromEntries(flags.map((flag, i) => [flag, !!(mask & (1 << i))]));
    const originalFlags = {...globals};
    const sixth = chapter(6, globals);
    sixth.call('onTalkTo', 'crystal_spirit');
    assert.equal(sixth.local.threshold_opened, true, `threshold opens for party mask ${mask}`);
    assert.deepEqual(sixth.loaded, ['chapter7.json']);
    assert.equal(globals.chapter, 7);
    for (const [i, speaker] of ['Vigil', 'Cobb', 'Vex', 'Nettle'].entries()) {
        if (!(mask & (1 << i))) assert.ok(!sixth.dialogue.some(([who]) => who === speaker), `${speaker} is absent`);
        assert.equal(globals[flags[i]], originalFlags[flags[i]], 'opening does not invent recruitment');
    }
    sixth.call('onTalkTo', 'crystal_spirit');
    assert.deepEqual(sixth.loaded, ['chapter7.json'], 'completed Warden does not repeat transition');
}

// Follow the exact skip-recruitment path that previously stranded a run.
const globals = {};
for (const [number, item] of [[2, 'vault_sigil'], [3, 'deepstone_ember'], [4, 'signal_core']]) {
    const current = chapter(number, globals);
    current.call('onItemCollected', item);
    assert.deepEqual(current.loaded, [`chapter${number + 1}.json`]);
}
const fifth = chapter(5, globals);
for (let i = 0; i < 3; ++i) fifth.call('onTalkTo', 'cyber_medic');
fifth.call('onItemCollected', 'cinder_charm');
assert.deepEqual(fifth.loaded, ['chapter6.json']);
const sixth = chapter(6, globals);
sixth.call('onTalkTo', 'crystal_spirit');
assert.deepEqual(sixth.loaded, ['chapter7.json']);
console.log('Chapter 6 progression passed: all 16 party combinations and skipped-recruitment campaign path');
