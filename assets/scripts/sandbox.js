// Demo level script - exercises every api.* command once, as a reference
// for future scripts. `api` is a global (not a parameter) - see
// ScriptEngine's header comment for why.
//
// A `function*` (generator) can pause itself with `yield api.wait(seconds)`
// or `yield api.say(speaker, text)`; a plain `function` just runs straight
// through and is done. Entry points are all optional - a map's script only
// needs to define whichever ones it actually uses.

function* onLevelStart() {
    yield api.say("Narrator", "Este nivel agora e' controlado por um script.");

    api.spawnEnemy("golem", 34, 9, 60);
    yield api.wait(1.5);

    api.spawnProp("signpost", 34, 11);
    yield api.say("Narrator", "Um golem apareceu perto do sinaleiro a leste!");
}

function* onEnemyDefeated(name) {
    yield api.say("Narrator", name + " foi derrotado!");
}

function* onPlayerDied() {
    yield api.say("Narrator", "Voce caiu em combate...");
}
