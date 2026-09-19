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
    src/AssetPath.cpp
    src/AssetPath.h
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


# ---- Install (Linux): `cmake --install build` / `make install` -------------
#
#   cmake -S . -B build -DCMAKE_INSTALL_PREFIX=$HOME/.local   # default: /usr/local
#   cmake --build build && cmake --install build              # sudo for /usr/local
#
# Installs the binary, the whole assets/ tree (~1 GB), the app icons and the
# launcher entry. The binary finds its assets at <prefix>/share/t2gu2/assets
# on its own (see src/AssetPath.h), so the install does not depend on the
# source tree staying where it was built. Set the prefix when configuring:
# the launcher's Exec= line is filled in from it here, at configure time.
# (-march=native above ties a Release binary to the CPU it was built on.)
include(GNUInstallDirs)

install(TARGETS T2gu2 RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(DIRECTORY assets/ DESTINATION ${CMAKE_INSTALL_DATADIR}/t2gu2/assets)

configure_file(packaging/t2gu2.desktop.in ${CMAKE_BINARY_DIR}/t2gu2.desktop @ONLY)
install(FILES ${CMAKE_BINARY_DIR}/t2gu2.desktop DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)

foreach(size 32 64 128 256 512)
    install(FILES assets/icons/app_icon_${size}.png
            DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/${size}x${size}/apps
            RENAME t2gu2.png)
endforeach()
