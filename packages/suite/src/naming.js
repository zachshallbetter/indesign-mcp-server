/**
 * Tool names in the suite: every app tool is prefixed with its app, without
 * repeating the app's name: create_document -> indesign_create_document,
 * indesign_status -> indesign_status, execute_illustrator_code ->
 * illustrator_execute_code. Cross-app tools have no app prefix.
 */
export function suiteToolName(appId, name) {
    return [appId, ...name.split('_').filter((part) => part !== appId)].join('_');
}

/** "InDesign: Place an image ..." so a client can tell the apps' tools apart. */
export function suiteDescription(label, description) {
    return `${label}: ${description}`;
}
