const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/chapter25.js'), 'utf8');
const forms = ['cyber_trooper', 'necromancer', 'crystal_spirit'];

function chapter(local = {}, globals = {}, totals = {xp: 0, loads: [], barriers: []}) {
    const enemies = [], potions = [], lines = [];
    const api = {
        getVar: (key, fallback) => local[key] ?? fallback,
        setVar: (key, value) => { local[key] = value; },
        getGlobalVar: (key, fallback) => globals[key] ?? fallback,
        setGlobalVar: (key, value) => { globals[key] = value; },
        hasItem: () => false,
        spawnEnemy: (name, col, row, hp) => enemies.push({name, x: (col + .5) * 128, y: (row + .5) * 128, hp}),
        spawnEnemyAtWorld: (name, x, y, hp) => {
            assert.ok(Number.isFinite(x) && Number.isFinite(y));
            enemies.push({name, x, y, hp});
        },
        spawnItemAtWorld: (name, x, y) => potions.push({name, x, y}),
        giveExperience: value => { totals.xp += value; },
        setBarrier: (id, col, row, width, height, blocked) => totals.barriers.push({id, blocked}),
        loadLevel: name => totals.loads.push(name),
        say: (speaker, text) => { lines.push({speaker, text}); return {}; },
        wait: () => ({}),
    };
    for (const method of ['spawnCharacter', 'giveControl', 'spawnProp', 'spawnNpc', 'spawnItem', 'playSound'])
        api[method] = () => {};
    const context = vm.createContext({api, Math});
    vm.runInContext(source, context);
    const result = {
        local, globals, totals, enemies, potions, lines,
        call(name, ...args) {
            const iterator = context[name](...args);
            if (iterator?.next) {
                let steps = 0;
                while (!iterator.next().done) assert.ok(++steps < 1000);
            }
        },
        boss() {
            const bosses = enemies.filter(enemy => forms.includes(enemy.name));
            assert.equal(bosses.length, 1, 'exactly one current boss form');
            return bosses[0];
        },
        kill(x, y) {
            const boss = result.boss();
            enemies.splice(enemies.indexOf(boss), 1);
            result.call('onEnemyDefeated', boss.name, x, y);
        },
        reload() {
            // Match the engine: saved vars before onLevelStart, then exact
            // surviving actor/loot positions at the readiness boundary.
            const loaded = chapter(structuredClone(local), structuredClone(globals), totals);
            loaded.call('onLevelStart');
            loaded.enemies.splice(0, loaded.enemies.length, ...structuredClone(enemies));
            loaded.potions.push(...structuredClone(potions));
            return loaded;
        },
    };
    return result;
}

for (const choices of [{}, {chord_notes: 9, guilds_at_peace: true, inquest_wrong: 2}]) {
    let current = chapter({}, choices);
    current.call('onLevelStart');
    assert.equal(current.boss().name, forms[0]);
    assert.equal(current.enemies.filter(enemy => forms.includes(enemy.name)).length, 1,
        'ordinary hostile packs reserve boss archetypes');
    current.call('onEnemyDefeated', 'wolf', 100, 200);
    assert.equal(current.local.boss_phase, undefined, 'unrelated defeat does not advance the boss');
    for (let phase = 0; phase < 3; ++phase) {
        const x = 1000.25 + phase * 317.5, y = 2000.75 - phase * 181.25;
        current.kill(x, y);
        assert.equal(current.local.boss_phase, phase + 1);
        if (phase < 2) {
            assert.deepEqual(current.boss(), {name: forms[phase + 1], x, y, hp: [200, 240][phase]});
            assert.deepEqual(current.potions.at(-1), {name: 'health_potion', x, y});
            const next = current.boss();
            next.x += 73.5; next.y += 41.25; next.hp -= 19;
            current = current.reload();
            assert.deepEqual(current.boss(), next, 'reload retains moved, damaged next form');
            assert.equal(current.potions.length, phase + 1, 'reload preserves phase potions without duplication');
        }
    }
    assert.equal(current.local.door_open, true);
    assert.equal(current.enemies.filter(enemy => forms.includes(enemy.name)).length, 0);
    assert.equal(current.totals.xp, 440, 'phase and completion awards happen once');
    assert.equal(current.totals.barriers.at(-1).blocked, false);
    current.call('onEnemyDefeated', forms[2], 900, 800);
    assert.equal(current.totals.xp, 440, 'duplicate final event cannot repeat rewards');
    current = current.reload();
    assert.equal(current.enemies.filter(enemy => forms.includes(enemy.name)).length, 0, 'completed boss stays gone');
    current.call('onItemCollected', 'second_door_key');
    assert.equal(current.globals.chapter, 26);
    assert.deepEqual(current.totals.loads, [], 'chapter 25 never loads a missing chapter 26');
}
console.log('Chapter 25 boss checks passed (all forms, exact death points, reloads, choices and ending)');
