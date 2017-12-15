"use strict";

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext.domain("gsconnect");
const _ = Gettext.gettext;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

// Local Imports
function getPath() {
    // Diced from: https://github.com/optimisme/gjs-examples/
    let m = new RegExp("@(.+):\\d+").exec((new Error()).stack.split("\n")[1]);
    return Gio.File.new_for_path(m[1]).get_parent().get_path();
}

imports.searchPath.push(getPath());

const Client = imports.client;
const Common = imports.common;
const DeviceWidget = imports.widgets.device;
const GSettingsWidget = imports.widgets.gsettings;
const KeybindingsWidget = imports.widgets.keybindings;
const PreferencesWidget = imports.widgets.preferences;


var AboutWidget = new Lang.Class({
    Name: "AboutWidget",
    Extends: Gtk.Grid,

    _init: function () {
        this.parent({
            margin_bottom: 18,
            row_spacing: 8,
            hexpand: true,
            halign: Gtk.Align.CENTER,
            orientation: Gtk.Orientation.VERTICAL
        });

        let aboutIcon = new Gtk.Image({
            icon_name: "org.gnome.Shell.Extensions.GSConnect",
            pixel_size: 128
        });
        this.add(aboutIcon);

        let aboutName = new Gtk.Label({
            label: "<b>" + _("GSConnect") + "</b>",
            use_markup: true
        });
        this.add(aboutName);

        let aboutVersion = new Gtk.Label({ label: Common.METADATA.version });
        this.add(aboutVersion);

        let aboutDescription = new Gtk.Label({
            label: _("KDE Connect implementation with Gnome Shell integration")
        });
        this.add(aboutDescription);

        let aboutWebsite = new Gtk.Label({
            label: '<a href="%s">%s</a>'.format(
                Common.METADATA.url,
                _("GSConnect Website")
            ),
            use_markup: true
        });
        this.add(aboutWebsite);

        let aboutCopyright = new Gtk.Label({
            label: "<small>" + _("Copyright © 2017 Andy Holmes") + "</small>",
            use_markup: true
        });
        this.add(aboutCopyright);

        let aboutLicense = new Gtk.Label({
            label: "<small>" +
            _("This program comes with absolutely no warranty.") + "\n" +
            _('See the <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html">GNU General Public License, version 2 or later</a> for details.') +
            "</small>",
            use_markup: true,
            justify: Gtk.Justification.CENTER
        });
        this.add(aboutLicense);
    }
});


/** A GtkStack subclass with a pre-attached GtkStackSwitcher */
var PrefsWidget = new Lang.Class({
    Name: "GSConnectPrefsWidget",
    Extends: PreferencesWidget.Stack,

    _init: function () {
        this.parent();

        this.daemon = new Client.Daemon();
        // Devices Page
        this.devicesStack = new DeviceWidget.Stack(this);
        let devicesPage = this.add_titled(
            this.devicesStack,
            "devices",
            _("Devices")
        );

        // Preferences Page
        let preferencesPage = this.addPage("preferences", _("Preferences"));

        let appearanceSection = preferencesPage.addSection(_("Appearance"));
        appearanceSection.addGSetting(Common.Settings, "show-indicators");
        appearanceSection.addGSetting(Common.Settings, "show-offline");
        appearanceSection.addGSetting(Common.Settings, "show-unpaired");
        appearanceSection.addGSetting(Common.Settings, "show-battery");

        let extensionsSection = preferencesPage.addSection(
            _("Extensions"),
            null,
            { margin_bottom: 0 }
        );
        extensionsSection.addGSetting(Common.Settings, "nautilus-integration");

        let chromeUrl = "https://chrome.google.com/webstore/detail/gsconnect/jfnifeihccihocjbfcfhicmmgpjicaec";
        let firefoxUrl = "https://addons.mozilla.org/en-US/firefox/addon/gsconnect/";
        extensionsSection.addSetting(
            _("Web Browser Integration"),
            _('Requires <a href="%s">Chrome Extension</a> or <a href="%s">Firefox Add-On</a>').format(
                "https://chrome.google.com/webstore/detail/gsconnect/jfnifeihccihocjbfcfhicmmgpjicaec",
                "https://addons.mozilla.org"
            ),
            new GSettingsWidget.BoolSetting(Common.Settings, "webbrowser-integration")
        );

        // About Page
        let aboutPage = this.addPage(
            "about",
            _("About"),
            { vscrollbar_policy: Gtk.PolicyType.NEVER }
        );
        aboutPage.box.add(new AboutWidget());
        aboutPage.box.margin_top = 18;

        let develSection = aboutPage.addSection(
            null,
            null,
            { margin_bottom: 0 }
        );
        develSection.addGSetting(Common.Settings, "debug");
        Common.Settings.connect("changed::debug", () => {
            if (Common.Settings.get_boolean("debug")) {
                GLib.spawn_command_line_async(
                    'gnome-terminal --tab --title "Daemon" --command "journalctl -f -o cat /usr/bin/gjs" --tab --title "Extension" --command "journalctl -f -o cat GNOME_SHELL_EXTENSION_UUID=gsconnect@andyholmes.github.io"'
                );
            }
        });

        this._watchdog = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            Client.BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            Lang.bind(this, this._serviceAppeared),
            Lang.bind(this, this._serviceVanished)
        );
    },

    _serviceAppeared: function (conn, name, name_owner) {
        Common.debug("PrefsWidget._serviceAppeared()");

        if (!this.daemon) {
            this.daemon = new Client.Daemon();
        }

        this.daemon.discovering = true;

        for (let dbusPath of this.daemon.devices.keys()) {
            this.devicesStack.addDevice(this.daemon, dbusPath);
        }

        // Watch for new and removed devices
        this.daemon.connect(
            "device::added",
            Lang.bind(this.devicesStack, this.devicesStack.addDevice)
        );

        this.daemon.connect(
            "device::removed",
            Lang.bind(this.devicesStack, this.devicesStack.removeDevice)
        );
    },

    _serviceVanished: function (conn, name) {
        Common.debug("PrefsWidget._serviceVanished()");

        if (this.daemon) {
            this.daemon.destroy();
            this.daemon = false;
        }

        if (!Common.Settings.get_boolean("debug")) {
            this.daemon = new Client.Daemon();
        }
    }
});


function init() {
    Common.debug("initializing extension preferences");

    Common.initConfiguration();
}

// Extension Preferences
function buildPrefsWidget() {
    Common.debug("Prefs: buildPrefsWidget()");

    let prefsWidget = new PrefsWidget();

    Mainloop.timeout_add(0, () => {
        let prefsWindow = prefsWidget.get_toplevel()
        prefsWindow.get_titlebar().custom_title = prefsWidget.switcher;
        prefsWindow.connect("destroy", () => {
            prefsWidget.daemon.discovering = false;
        });
        return false;
    });

    prefsWidget.show_all();
    return prefsWidget;
}

