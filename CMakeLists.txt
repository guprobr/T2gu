cmake_minimum_required(VERSION 3.16)

# Defaults to Release (-O3 -DNDEBUG) when nothing else is requested -
# without this, a plain `cmake -S . -B build` silently produces an
# unoptimized build (CMake's own default build type is empty, not Debug
# or Release), and that's easy to lose track of across a `rm -rf build`/
# reconfigure, exactly as happened once already in this project's history.
# Still overridable the normal way (-DCMAKE_BUILD_TYPE=Debug) for anyone
# who actually wants that.
if (NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type" FORCE)
endif()

project(T2gu2 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Qml Multimedia)

add_executable(T2gu2
    src/main.cpp
    src/MainWindow.cpp
    src/MainWindow.h
    src/GameScene.cpp
    src/GameScene.h
    src/SpriteSheet.cpp
    src/SpriteSheet.h
    src/Character.cpp
    src/Character.h
    src/TileSheet.cpp
    src/TileSheet.h
    src/TileMap.cpp
    src/TileMap.h
    src/TileMapItem.cpp
    src/TileMapItem.h
    src/LightingOverlayItem.cpp
    src/LightingOverlayItem.h
    src/Prop.cpp
    src/Prop.h
    src/ScriptEngine.cpp
    src/ScriptEngine.h
    src/ScriptBridge.cpp
    src/ScriptBridge.h
    src/DialogueBoxWidget.cpp
    src/DialogueBoxWidget.h
    src/InventoryWidget.cpp
    src/InventoryWidget.h
    src/DeathMenuWidget.cpp
    src/DeathMenuWidget.h
    src/LoadingOverlayWidget.cpp
    src/LoadingOverlayWidget.h
    src/LevelUpTextItem.cpp
    src/LevelUpTextItem.h
    src/FireballItem.cpp
    src/FireballItem.h
    src/AudioManager.cpp
    src/AudioManager.h
    src/SelectionInfoWidget.cpp
    src/SelectionInfoWidget.h
    src/GameState.h
    src/Version.h
)

target_link_libraries(T2gu2 PRIVATE Qt6::Widgets Qt6::Qml Qt6::Multimedia)
target_compile_definitions(T2gu2 PRIVATE ASSET_DIR="${CMAKE_SOURCE_DIR}/assets")

# Already builds Release/-O3 by default (see CMAKE_BUILD_TYPE) - these go a
# step further: -march=native lets the compiler use whatever instruction
# set the build machine's own CPU actually supports (AVX2/FMA/etc.)
# instead of a portable baseline, and interprocedural (link-time)
# optimization lets it inline/optimize across the .cpp file boundaries
# that -O3 alone can't see through (e.g. GameScene.cpp calling into
# Character.cpp's hot per-tick functions). Only applied for Release builds
# - -march=native ties the binary to this build machine's specific CPU, a
# fine tradeoff for a locally-built desktop game never redistributed to a
# different machine, but wrong for anything that would be.
if (CMAKE_BUILD_TYPE STREQUAL "Release")
    include(CheckCXXCompilerFlag)
    check_cxx_compiler_flag("-march=native" T2GU_HAS_MARCH_NATIVE)
    if (T2GU_HAS_MARCH_NATIVE)
        target_compile_options(T2gu2 PRIVATE -march=native)
    endif()
    include(CheckIPOSupported)
    check_ipo_supported(RESULT T2GU_IPO_SUPPORTED)
    if (T2GU_IPO_SUPPORTED)
        set_property(TARGET T2gu2 PROPERTY INTERPROCEDURAL_OPTIMIZATION TRUE)
    endif()
endif()
