const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/chapter15.js'), 'utf8');
const waveNames = new Set(['wolf', 'ice_spirit', 'slime_ice', 'tiger']);
const counts = [6, 8, 7];

function chapter(local = {}, totals = {xp: 0, gems: 0}) {
    const enemies = [];
    const methods = {
        getVar: (key, fallback) => local[key] ?? fallback,
        setVar: (key, value) => { local[key] = value; },
        getGlobalVar: (key, fallback) => fallback,
        spawnEnemy: (name, col, row, hp) => { enemies.push({name, col, row, hp}); },
        giveExperience: amount => { totals.xp += amount; },
        giveItem: (name, count) => {
            assert.equal(name, 'gemstone_cluster');
            totals.gems += count;
        },
        say: () => ({}), wait: () => ({}),
    };
    for (const name of ['spawnCharacter', 'giveControl', 'spawnProp', 'setBarrier', 'spawnNpc', 'spawnItem', 'playSound'])
        methods[name] = () => {};
    const context = vm.createContext({api: methods, Math});
    vm.runInContext(source, context);
    const result = {
        local, totals, enemies,
        call(name, ...args) {
            const iterator = context[name](...args);
            if (iterator?.next) {
                let steps = 0;
                while (!iterator.next().done) assert.ok(++steps < 1000, 'bounded quest sequence');
            }
        },
        waveEnemies() { return enemies.filter(enemy => waveNames.has(enemy.name)); },
        killOne() {
            const index = enemies.findIndex(enemy => waveNames.has(enemy.name));
            assert.ok(index >= 0, 'a wave enemy remains');
            const [enemy] = enemies.splice(index, 1);
            result.call('onEnemyDefeated', enemy.name);
        },
        reload() {
            // The engine loads saved vars before onLevelStart and restores
            // surviving entities after population, at the readiness boundary.
            const savedEnemies = structuredClone(enemies);
            const loaded = chapter(structuredClone(local), totals);
            loaded.call('onLevelStart');
            assert.equal(loaded.waveEnemies().length, 0, 'initialization does not spawn another wave');
            loaded.enemies.splice(0, loaded.enemies.length, ...savedEnemies);
            return loaded;
        },
    };
    return result;
}

let scenarios = 0;
for (let targetWave = 0; targetWave < counts.length; ++targetWave) {
    for (let killed = 0; killed < counts[targetWave]; ++killed) {
        let current = chapter();
        current.call('onLevelStart');
        current.call('onTalkTo', 'crystal_spirit'); // briefing
        for (let wave = 0; wave < counts.length; ++wave) {
            current.call('onTalkTo', 'crystal_spirit');
            assert.equal(current.waveEnemies().length, counts[wave]);
            if (wave === targetWave) {
                for (let i = 0; i < killed; ++i) current.killOne();
                const remaining = counts[wave] - killed;
                for (let reload = 0; reload < 2; ++reload) {
                    current = current.reload();
                    assert.equal(current.local.vigil_active, true, 'partial wave stays active after reload');
                    assert.equal(current.local.vigil_alive, remaining, 'saved counter matches survivors');
                    assert.equal(current.local.vigil_wave ?? 0, wave);
                    current.call('onTalkTo', 'crystal_spirit');
                    assert.equal(current.waveEnemies().length, remaining, 'active-wave dialogue does not duplicate enemies');
                    current.call('onEnemyDefeated', 'goblin');
                    assert.equal(current.local.vigil_alive, remaining, 'unrelated kills do not change wave counter');
                }
            }
            while (current.waveEnemies().length) current.killOne();
            assert.equal(current.local.vigil_alive, 0);
            assert.equal(current.local.vigil_wave, wave + 1);
            assert.equal(current.local.vigil_active, false);
        }
        assert.equal(current.local.vigil_held, true);
        assert.equal(current.totals.xp, 240, 'each wave and completion reward awarded once');
        assert.equal(current.totals.gems, 1);
        current = current.reload();
        current.call('onTalkTo', 'crystal_spirit');
        assert.equal(current.waveEnemies().length, 0, 'completed vigil stays complete');
        assert.equal(current.totals.xp, 240);
        assert.equal(current.totals.gems, 1);
        ++scenarios;
    }
}
console.log(`Chapter 15 reload passed: ${scenarios} partial-wave states, repeated reloads, and completion rewards`);
