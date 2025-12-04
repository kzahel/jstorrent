for VER in "JSTorrent Dev" "JSTorrent Lite" "JSTorrent"; do

rm "package-$VER.zip"
sed -i.bak "s/JSTorrent Dev/$VER/g" _locales/en/messages.json
sed -i.bak '/\"key\":/d' manifest.json
cp conf.js conf.js.bak
cp conf_prod.js conf.js

zip "package-$VER.zip" manifest.json \
    -r _locales \
    *.js \
    *.png \
    README.md \
    LICENSE \
    CHANGES.txt \
    TODO.txt \
    images/js-*.png \
    images/cws_32.png \
    images/js-mini-logo-2x.png \
    js/*.js \
    js/deps/*.js \
    js/deps/SlickGrid/*.js \
    js/deps/SlickGrid/slick.grid.css \
    js/deps/SlickGrid/css/smoothness/jquery-ui-1.8.16.custom.css \
    js/deps/SlickGrid/css/smoothness/images/*.png \
    js/deps/SlickGrid/images/sort-*.gif \
    js/deps/SlickGrid/plugins/slick.rowselectionmodel.js \
    js/deps/SlickGrid/lib/jquery.event.drag-2.2.js \
    js/deps/bootstrap-dist/css/bootstrap.min.css \
    js/deps/bootstrap-dist/js/bootstrap.min.js \
    js/deps/bootstrap-dist/fonts/glyphicons-halflings-regular.woff \
    gui/*.js \
    gui/*.css \
    gui/*.html \
    js/web-server-chrome/*.js \
    -x js/web-server-chrome/*buy* \
    -x js/*old* \
    -x *scratch* \
    -x "*.*~"    

mv _locales/en/messages.json.bak _locales/en/messages.json
mv manifest.json.bak manifest.json
mv conf.js.bak conf.js;

done
