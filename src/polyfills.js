/* ---------- crypto.randomUUID() ---------- */
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = () =>
  ([1e7]+-1e3+-4e3+-8e3+-1e11)
  .replace(/[018]/g, c =>
  (
  c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4
  ).toString(16)
  )
  }


  /* ---------- BroadcastChannel polyfill ------------- *
  Uses localStorage “storage” events for cross-tab comms.
  •  Echoes message to same tab (matches real BC behaviour)
  •  Removes key immediately to avoid quota bloat
  */
  if (typeof self !== 'undefined' && !('BroadcastChannel' in self)) {
  class BCPoly {
  constructor (name) {
  this.name = name
  this.onmessage = null


    addEventListener('storage', e => {
      if (e.key !== `__bc_${name}` || !e.newValue) return
      const payload = JSON.parse(e.newValue)
      this.onmessage?.({ data: payload.msg })
      // clean up storage (prevent quota growth)
      localStorage.removeItem(`__bc_${name}`)
    })
  }

  postMessage (msg) {
    const payload = JSON.stringify({ msg, t: Date.now() })
    localStorage.setItem(`__bc_${this.name}`, payload)
    // real BC also delivers to origin tab:
    this.onmessage?.({ data: msg })
    // and remove
    localStorage.removeItem(`__bc_${this.name}`)
  }

  close () { /* noop */ }

  }


  self.BroadcastChannel = BCPoly
  }
