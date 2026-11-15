#!/bin/zsh
# Compila Skills Viewer.app in Apps/: poi puoi trascinarla in Applicazioni.
set -euo pipefail

project_dir="${0:A:h:h}"
app_dir="$project_dir/Apps/Skills Viewer.app"

cd "$project_dir"
swift build -c release --product SkillsViewer

# icona: disegnata una volta sola (cancella Resources/AppIcon.png per rifarla)
if [[ ! -f Resources/AppIcon.png ]]; then
    swift Scripts/make-icon.swift Resources/AppIcon.png
fi
iconset_dir="$project_dir/.build/AppIcon.iconset"
rm -rf "$iconset_dir" && mkdir -p "$iconset_dir"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" Resources/AppIcon.png --out "$iconset_dir/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) Resources/AppIcon.png --out "$iconset_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset_dir" -o Resources/AppIcon.icns

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp .build/release/SkillsViewer "$app_dir/Contents/MacOS/SkillsViewer"
cp Resources/Info.plist "$app_dir/Contents/Info.plist"
cp Resources/AppIcon.icns "$app_dir/Contents/Resources/AppIcon.icns"
cp server.js index.html package.json "$app_dir/Contents/Resources/"

# versione dell'app = versione in package.json
version=$(node -p "require('./package.json').version")
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$app_dir/Contents/Info.plist"

# le skill dei progetti si cercano nella cartella che contiene Skills Viewer (es. ~/Documents/GitHub)
/usr/libexec/PlistBuddy -c "Add :SkillsViewerProjectsDir string ${project_dir:h}" "$app_dir/Contents/Info.plist"

# firma locale ad hoc: basta per usarla sul proprio Mac (non è una notarizzazione Apple)
codesign --force --sign - "$app_dir"
touch "$app_dir"

lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[[ -x "$lsregister" ]] && "$lsregister" -f "$app_dir"

echo "App pronta: $app_dir"
