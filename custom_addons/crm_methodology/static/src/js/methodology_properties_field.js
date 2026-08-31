/** @odoo-module **/

import { registry } from "@web/core/registry";
import { PropertiesField, propertiesField } from "@web/views/fields/properties/properties_field";

// The opportunity's `lead_properties` are defined per Sales Team (see docs/adr/0005), so the
// stock widget would show every Property key any methodology has ever needed on that team, not
// just the ones this opportunity's own methodology owns. Filter the displayed list down to
// `methodology_property_keys` (computed alongside), leaving values/definitions for every other
// key on the record untouched so syncing, saving, and other methodologies' data keep working.
export class CrmMethodologyPropertiesField extends PropertiesField {
    get propertiesList() {
        const keysValue = this.props.record.data.methodology_property_keys;
        if (keysValue === undefined || keysValue === null) {
            // the field isn't present on this record (e.g. this widget used outside the
            // opportunity form) — fall back to the stock, unfiltered behavior.
            return super.propertiesList;
        }
        const ownKeys = new Set(keysValue ? keysValue.split(",") : []);
        return super.propertiesList.filter(
            (definition) => definition.type === "separator" || ownKeys.has(definition.name)
        );
    }
}

export const crmMethodologyPropertiesField = {
    ...propertiesField,
    component: CrmMethodologyPropertiesField,
};

registry.category("fields").add("crm_methodology_properties", crmMethodologyPropertiesField);
