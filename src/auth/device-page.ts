import { deviceClients } from "./auth";

// The page the desktop app opens (GET /device): sign in with Google here, then approve or deny the code the app shows. It runs on the API's own origin, so the
// session cookie of the sign-in is the one the approval needs. The code and every answer are put in with textContent, never as HTML.
export function devicePageHtml(): string {
  const clients = JSON.stringify(deviceClients);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Neonix</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #141414; color: #ededed; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: min(420px, calc(100vw - 32px)); background: #292929; border-radius: 12px; padding: 28px; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 8px 0; color: #c8c8c8; }
  .code { margin: 16px 0; padding: 12px; text-align: center; font: 600 26px/1 ui-monospace, Menlo, monospace; letter-spacing: 4px; background: #141414; border-radius: 8px; color: #fff; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
  .primary { background: #19aef6; color: #071218; }
  .secondary { background: #3b3b3b; color: #ededed; }
  .row { display: flex; gap: 8px; margin-top: 16px; }
  .row button { flex: 1; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #4f4f4f; background: #141414; color: #fff; font: 600 18px ui-monospace, Menlo, monospace; letter-spacing: 3px; text-transform: uppercase; }
  .error { color: #ff8a80; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1 id="title">Sign in to Neonix</h1>
  <p id="message"></p>
  <div id="code" class="code" hidden></div>
  <form id="enter" hidden>
    <input id="entered" maxlength="12" autocomplete="off" placeholder="ABCD-2345" aria-label="Code shown in the app">
    <div class="row"><button class="primary" type="submit">Continue</button></div>
  </form>
  <div id="signin" class="row" hidden><button id="google" class="primary" type="button">Continue with Google</button></div>
  <div id="decide" class="row" hidden>
    <button id="approve" class="primary" type="button">Approve</button>
    <button id="deny" class="secondary" type="button">Deny</button>
  </div>
</main>
<script>
(function () {
  var clients = ${clients};
  var $ = function (id) { return document.getElementById(id); };
  var raw = new URLSearchParams(location.search).get("user_code") || "";
  var code = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  var shown = code.length > 4 ? code.slice(0, 4) + "-" + code.slice(4) : code;

  function show(title, message, isError) {
    $("title").textContent = title;
    $("message").textContent = message;
    $("message").className = isError ? "error" : "";
    ["enter", "signin", "decide", "code"].forEach(function (id) { $(id).hidden = true; });
  }
  function reveal() { for (var i = 0; i < arguments.length; i++) $(arguments[i]).hidden = false; }
  function call(path, options) {
    return fetch("/api/auth" + path, Object.assign({ credentials: "same-origin", headers: { "content-type": "application/json" } }, options))
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (body) { return { ok: r.ok, body: body }; }); });
  }

  if (code.length < 6) {
    show("Enter the code", "Type the code your Neonix app is showing.", false);
    reveal("enter");
    $("enter").addEventListener("submit", function (event) {
      event.preventDefault();
      var typed = $("entered").value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (typed.length >= 6) location.href = "/device?user_code=" + encodeURIComponent(typed);
    });
    return;
  }

  call("/get-session", { method: "GET" }).then(function (session) {
    var who = session.body && session.body.user;
    if (!who) {
      show("Sign in to Neonix", "Sign in, then approve the code your Neonix app is showing.", false);
      $("code").textContent = shown;
      reveal("code", "signin");
      $("google").onclick = function () {
        call("/sign-in/social", { method: "POST", body: JSON.stringify({ provider: "google", callbackURL: "/device?user_code=" + encodeURIComponent(code) }) })
          .then(function (r) { if (r.body && r.body.url) location.href = r.body.url; else show("Could not sign in", "Try again in a moment.", true); });
      };
      return;
    }
    call("/device?user_code=" + encodeURIComponent(code), { method: "GET" }).then(function (r) {
      var request = r.body;
      if (!r.ok || !request || !request.client_id) {
        show("This code cannot be used", "It is wrong, has expired, or was opened by another account. Start the sign-in again in the app.", true);
        return;
      }
      var name = clients[request.client_id];
      if (!name) { show("Unknown app", "This request comes from an app Neonix does not know.", true); return; }
      show("Approve " + name + "?", "Signed in as " + who.email + ". Approve only if this code is showing right now in " + name + ", on a device you have.", false);
      $("code").textContent = shown;
      reveal("code", "decide");
      function decide(action) {
        $("approve").disabled = true; $("deny").disabled = true;
        call("/device/" + action, { method: "POST", body: JSON.stringify({ userCode: code }) }).then(function (done) {
          if (!done.ok) { show("Something went wrong", "The code may have expired. Start the sign-in again in the app.", true); return; }
          show(action === "approve" ? "You are signed in" : "Sign-in denied", action === "approve" ? "You can close this page and go back to " + name + "." : "Nothing was shared with the app.", false);
        });
      }
      $("approve").onclick = function () { decide("approve"); };
      $("deny").onclick = function () { decide("deny"); };
    });
  });
})();
</script>
</body>
</html>`;
}
