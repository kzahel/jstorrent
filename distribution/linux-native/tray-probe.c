/* Independently authored GTK/appindicator probe, under the project MIT license.
 * This is a test executable, never bundled in the product.
 */
#include <gtk/gtk.h>
#include <app-indicator.h>

static int activated;
static void on_activate(GtkMenuItem *item, gpointer data) {
    (void)item;
    (void)data;
    activated++;
}

int main(int argc, char **argv) {
    gtk_init(&argc, &argv);
    AppIndicator *indicator = app_indicator_new("jstorrent-native-probe",
        "application-x-bittorrent", APP_INDICATOR_CATEGORY_APPLICATION_STATUS);
    g_assert(indicator != NULL);
    GtkWidget *menu = gtk_menu_new();
    const char *labels[] = {"Show JSTorrent", "Run in background", "Quit"};
    for (int i = 0; i < 3; i++) {
        GtkWidget *item = gtk_menu_item_new_with_label(labels[i]);
        g_signal_connect(item, "activate", G_CALLBACK(on_activate), NULL);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
        gtk_widget_show(item);
        gtk_menu_item_activate(GTK_MENU_ITEM(item));
    }
    g_assert_cmpint(activated, ==, 3);
    app_indicator_set_menu(indicator, GTK_MENU(menu));
    g_assert(app_indicator_get_menu(indicator) == GTK_MENU(menu));
    app_indicator_set_status(indicator, APP_INDICATOR_STATUS_ACTIVE);
    g_assert_cmpint(app_indicator_get_status(indicator), ==, APP_INDICATOR_STATUS_ACTIVE);
    app_indicator_set_icon_full(indicator, "application-x-bittorrent", "JSTorrent");
    g_assert_cmpstr(app_indicator_get_icon(indicator), ==, "application-x-bittorrent");
    /* The explicitly disabled API remains callable and leaves ordinary menus intact. */
    app_indicator_build_menu_from_desktop(indicator, "/unused-probe.desktop", "unused");
    g_assert(app_indicator_get_menu(indicator) == GTK_MENU(menu));
    app_indicator_set_status(indicator, APP_INDICATOR_STATUS_PASSIVE);
    g_assert_cmpint(app_indicator_get_status(indicator), ==, APP_INDICATOR_STATUS_PASSIVE);
    g_object_unref(indicator);
    g_print("PASS ordinary GTK menu callbacks, icon, active/passive status and preserved disabled API\n");
    return 0;
}
