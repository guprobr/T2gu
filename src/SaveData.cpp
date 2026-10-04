#include "SaveData.h"
#include "AssetPath.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImageReader>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QSet>
#include <cmath>
#include <utility>

namespace {
bool integer(const QJsonValue &value, int &out, int minimum, int maximum, int fallback = -1)
{
    if (value.isUndefined() && fallback >= minimum && fallback <= maximum) {
        out = fallback;
        return true;
    }
    if (!value.isDouble())
        return false;
    const double n = value.toDouble();
    if (!std::isfinite(n) || std::floor(n) != n || n < minimum || n > maximum)
        return false;
    out = static_cast<int>(n);
    return true;
}

bool number(const QJsonValue &value, qreal &out, qreal minimum, qreal maximum, bool optional = false)
{
    if (optional && value.isUndefined()) {
        out = 0;
        return true;
    }
    if (!value.isDouble())
        return false;
    out = value.toDouble();
    return std::isfinite(out) && out >= minimum && out <= maximum;
}

bool identifier(const QString &name)
{
    static const QRegularExpression pattern(QStringLiteral("^[A-Za-z0-9_]{1,96}$"));
    return pattern.match(name).hasMatch();
}

QJsonObject readObject(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly) || file.size() > 1024 * 1024)
        return {};
    QJsonParseError error;
    const auto doc = QJsonDocument::fromJson(file.readAll(), &error);
    return error.error == QJsonParseError::NoError && doc.isObject() ? doc.object() : QJsonObject{};
}

bool readBuffs(const QJsonValue &value, Character::TemporaryBuffs &buffs)
{
    if (value.isUndefined())
        return true; // Older version 2 saves have no buff channels.
    if (!value.isObject())
        return false;
    const auto obj = value.toObject();
    auto channel = [&obj](const char *amountKey, const char *timeKey, int &amount, qreal &time) {
        return integer(obj.value(amountKey), amount, 0, 1000000, 0)
            && number(obj.value(timeKey), time, 0, 1000000000, true)
            && (amount == 0 || time > 0);
    };
    return channel("strength", "strengthRemaining", buffs.strength, buffs.strengthRemaining)
        && channel("intelligence", "intelligenceRemaining", buffs.intelligence, buffs.intelligenceRemaining)
        && channel("speed", "speedRemaining", buffs.speed, buffs.speedRemaining);
}

class SnapshotReader
{
public:
    explicit SnapshotReader(const TileMap &map) : m_map(map) {}

    bool characters(const QJsonValue &value, QVector<GameScene::CharacterSnapshot> &out, bool npc, int limit)
    {
        if (value.isUndefined())
            return true;
        if (!value.isArray() || value.toArray().size() > limit)
            return false;
        for (const auto &entry : value.toArray()) {
            if (!entry.isObject())
                return false;
            const auto obj = entry.toObject();
            GameScene::CharacterSnapshot actor;
            actor.name = obj.value("name").toString();
            if (!identifier(actor.name)
                    || !number(obj.value("x"), actor.x, -100000, m_map.pixelWidth())
                    || !number(obj.value("y"), actor.y, -100000, m_map.pixelHeight())
                    || !integer(obj.value("maxHp"), actor.maxHp, npc ? 0 : 1, npc ? 0 : 2000000)
                    || !integer(obj.value("hp"), actor.hp, 0, actor.maxHp)
                    || !readBuffs(obj.value("temporaryBuffs"), actor.temporaryBuffs))
                return false;
            if (!m_sizes.contains(actor.name)) {
                const QString sidecar = assetPath(QStringLiteral("/characters/%1/%1.json")).arg(actor.name);
                const auto metadata = readObject(sidecar);
                int width;
                qreal height;
                if (!integer(metadata.value("frameWidth"), width, 1, 100000)
                        || !number(metadata.value("frameHeight"), height, 1, 100000)
                        || !metadata.value("rows").isArray() || metadata.value("rows").toArray().isEmpty())
                    return false;
                QImageReader image(QFileInfo(sidecar).dir().filePath(metadata.value("sheet").toString()));
                if (!image.canRead() || image.size().width() < width || image.size().height() < height)
                    return false;
                m_sizes.insert(actor.name, QSizeF(width, height));
            }
            const QSizeF size = m_sizes.value(actor.name);
            // Raw sprite positions can be negative: the padded cell is
            // anchored by its feet, not by its upper-left corner.
            const QPointF feet(actor.x + size.width() / 2,
                               actor.y + size.height() * SpriteSheet{}.feetFraction());
            if (feet.x() < 0 || feet.y() < 0 || feet.x() >= m_map.pixelWidth() || feet.y() >= m_map.pixelHeight())
                return false;
            out.append(actor);
        }
        return true;
    }

private:
    const TileMap &m_map;
    QHash<QString, QSizeF> m_sizes;
};
}

bool parseSavedGame(const QByteArray &json, LoadedSave &out, QString &error)
{
    auto fail = [&error](const QString &reason) { error = reason; return false; };
    if (json.size() > kMaxSaveBytes)
        return fail(QStringLiteral("Save file exceeds the 8 MiB limit."));
    QJsonParseError parseError;
    const auto doc = QJsonDocument::fromJson(json, &parseError);
    if (parseError.error != QJsonParseError::NoError || !doc.isObject())
        return fail(QStringLiteral("Save file is corrupt and can't be read."));
    const auto root = doc.object();
    int version;
    if (!integer(root.value("saveVersion"), version, 1, 100000, 1))
        return fail(QStringLiteral("Invalid save version."));
    if (version > 2)
        return fail(QStringLiteral("This save was made by a newer version of the game."));
    if (version < 2)
        return fail(QStringLiteral("This save is from an older, incompatible version of the game."));

    LoadedSave candidate;
    const auto mapName = root.value("map");
    if (!mapName.isUndefined() && (!mapName.isString() || mapName.toString().isEmpty()))
        return fail(QStringLiteral("Invalid saved map filename."));
    if (mapName.isString()) {
        const QString name = mapName.toString();
        if (name.size() > 256 || QFileInfo(name).fileName() != name || name.contains('\\') || !name.endsWith(".json"))
            return fail(QStringLiteral("Invalid saved map filename."));
        candidate.mapPath = assetPath(QStringLiteral("/maps/")) + name;
    } else {
        const auto path = root.value("mapPath");
        if (!path.isString() || path.toString().isEmpty() || path.toString().size() > 4096)
            return fail(QStringLiteral("Save file's map is missing."));
        candidate.mapPath = path.toString(); // Read-only legacy filename fallback.
    }
    TileMap map;
    QString mapError;
    if (!map.load(candidate.mapPath, &mapError))
        return fail(QStringLiteral("Saved map could not be loaded: %1").arg(mapError));

    auto &state = candidate.state;
    if (!integer(root.value("level"), state.level, 1, 100000, 1)
            || !integer(root.value("experience"), state.experience, 0, state.level * 100 - 1, 0)
            || !integer(root.value("itemBonusStrength"), state.itemBonusStrength, 0, 1000000, 0)
            || !integer(root.value("itemBonusIntelligence"), state.itemBonusIntelligence, 0, 1000000, 0)
            || !integer(root.value("itemBonusMaxHp"), state.itemBonusMaxHp, 0, 1000000, 0)
            || !integer(root.value("heroBaseMaxHp"), state.heroBaseMaxHp, 1, 1000000, 200))
        return fail(QStringLiteral("Invalid saved level, experience, or permanent stats."));
    const auto track = root.value("lastMusicTrack");
    if (!track.isUndefined() && (!track.isString() || track.toString().size() > 128))
        return fail(QStringLiteral("Invalid saved music name."));
    state.lastMusicTrack = track.toString();

    const auto vars = root.value("vars");
    if (!vars.isUndefined() && (!vars.isObject() || vars.toObject().size() > 10000))
        return fail(QStringLiteral("Invalid saved story variables."));
    const auto variables = vars.toObject();
    for (auto it = variables.constBegin(); it != variables.constEnd(); ++it) {
        const auto v = it.value();
        if (it.key().isEmpty() || it.key().size() > 256
                || !(v.isBool() || v.isString() || (v.isDouble() && std::isfinite(v.toDouble())))
                || (v.isString() && v.toString().size() > 8192))
            return fail(QStringLiteral("Invalid saved story variable: %1").arg(it.key()));
        state.vars.insert(it.key(), v.toVariant());
    }

    const auto inventory = root.value("inventory");
    if (!inventory.isUndefined() && (!inventory.isObject() || inventory.toObject().size() > 2048))
        return fail(QStringLiteral("Invalid saved inventory."));
    const auto catalog = readObject(assetPath(QStringLiteral("/items/items.json"))).value("items").toObject();
    const auto held = inventory.toObject();
    for (auto it = held.constBegin(); it != held.constEnd(); ++it) {
        int count;
        if (!catalog.value(it.key()).isObject() || !integer(it.value(), count, 0, 1000000))
            return fail(QStringLiteral("Invalid saved item or count: %1").arg(it.key()));
        state.inventory.insert(it.key(), count);
    }

    if (!root.value("scene").isObject())
        return fail(QStringLiteral("Missing or invalid scene snapshot."));
    const auto scene = root.value("scene").toObject();
    auto &snapshot = candidate.snapshot;
    SnapshotReader reader(map);
    if (!scene.value("party").isArray()
            || !reader.characters(scene.value("party"), snapshot.party, false, 256)
            || !reader.characters(scene.value("enemies"), snapshot.enemies, false, 8192)
            || !reader.characters(scene.value("npcs"), snapshot.npcs, true, 2048))
        return fail(QStringLiteral("Invalid saved characters, positions, health, or buffs."));
    QSet<QString> unique;
    for (const auto &actor : snapshot.party) {
        if (unique.contains(actor.name))
            return fail(QStringLiteral("Duplicate saved party member."));
        unique.insert(actor.name);
    }
    for (const auto &actor : snapshot.npcs) {
        if (unique.contains(actor.name))
            return fail(QStringLiteral("Duplicate or conflicting saved NPC."));
        unique.insert(actor.name);
    }
    for (const auto &actor : snapshot.enemies) {
        if (actor.hp <= 0 || unique.contains(actor.name))
            return fail(QStringLiteral("Dead or conflicting saved enemy."));
    }
    const auto controlled = scene.value("controlledName");
    if (!controlled.isString())
        return fail(QStringLiteral("Missing controlled party member."));
    snapshot.controlledName = controlled.toString();
    bool livingControlled = snapshot.party.isEmpty() && snapshot.controlledName.isEmpty();
    for (const auto &actor : snapshot.party)
        livingControlled |= actor.name == snapshot.controlledName && actor.hp > 0;
    if (!livingControlled)
        return fail(QStringLiteral("Saved controlled character is missing or dead."));

    const auto items = scene.value("items");
    if (!items.isUndefined() && (!items.isArray() || items.toArray().size() > 16384))
        return fail(QStringLiteral("Invalid saved world items."));
    for (const auto &entry : items.toArray()) {
        if (!entry.isObject())
            return fail(QStringLiteral("Invalid saved world item."));
        const auto obj = entry.toObject();
        GameScene::ItemSnapshot item;
        item.itemId = obj.value("itemId").toString();
        if (!catalog.value(item.itemId).isObject()
                || !number(obj.value("x"), item.x, 0, map.pixelWidth())
                || !number(obj.value("y"), item.y, 0, map.pixelHeight())
                || item.x >= map.pixelWidth() || item.y >= map.pixelHeight())
            return fail(QStringLiteral("Invalid saved world item or position."));
        snapshot.items.append(item);
    }
    out = std::move(candidate);
    error.clear();
    return true;
}
