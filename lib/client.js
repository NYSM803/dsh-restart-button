/**
 * dsh-restart-button — browser half.
 *
 * Mounts one floating, draggable restart button onto the document body (not a
 * session slot: the button must exist on the new-conversation screen too), and
 * a "重启按钮" settings section that edits the button's icon, background colour
 * and position lock. Both read and write the host's '/api/restart-button/*'
 * endpoints; a module-local listener list keeps the floating button in step
 * with what the settings card saves.
 * @module dsh-restart-button/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-restart-button',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    /** Endpoint prefix served by the plugin's host half. */
    var API = '/api/restart-button'
    /** Button edge length in CSS pixels. */
    var SIZE = 44
    /** Smallest gap kept between the button and the viewport edge. */
    var MARGIN = 8

    /** The four built-in glyphs, as the inner markup of a 24x24 stroke icon. */
    var ICONS = {
      rewind: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>',
      power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
      refresh: '<path d="M21 12a9 9 0 0 1-15.2 6.5L3 16"/><path d="M3 12a9 9 0 0 1 15.2-6.5L21 8"/><polyline points="21 3 21 8 16 8"/><polyline points="3 21 3 16 8 16"/>',
      cycle: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9"/><polyline points="20 3.5 20 9 14.5 9"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 15"/><polyline points="4 20.5 4 15 9.5 15"/>',
    }
    /** Presentation order of the built-in glyphs in the settings card. */
    var ICON_ORDER = ['rewind', 'power', 'refresh', 'cycle']
    /** Human labels of the built-in glyphs. */
    var ICON_LABELS = { rewind: '环形箭头', power: '电源键', refresh: '双箭头刷新', cycle: '循环箭头', custom: '自定义图片' }

    /** The stylesheet, injected once per document. */
    var CSS = [
      '.dsh-rb-root{position:fixed;z-index:2147483000;width:' + SIZE + 'px;height:' + SIZE + 'px;touch-action:none;user-select:none}',
      '.dsh-rb-button{all:unset;position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;cursor:grab;color:inherit;',
      'background:var(--dsw-alias-bg-layer-2,rgba(28,32,42,.9));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));',
      'box-shadow:0 6px 20px var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.32));backdrop-filter:blur(8px);',
      'transition:transform .12s ease,background .12s ease,box-shadow .12s ease}',
      '.dsh-rb-button:hover{box-shadow:0 8px 24px var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.4))}',
      '.dsh-rb-root:not([data-locked="true"]) .dsh-rb-button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(48,54,68,.95))}',
      '.dsh-rb-root:not([data-locked="true"]) .dsh-rb-button:active{cursor:grabbing;transform:scale(.94)}',
      '.dsh-rb-root[data-dragging="true"] .dsh-rb-button{cursor:grabbing;transform:scale(1.06);transition:none}',
      '.dsh-rb-root[data-locked="true"] .dsh-rb-button{cursor:pointer}',
      '.dsh-rb-button svg{width:22px;height:22px;display:block}',
      '.dsh-rb-button img{width:22px;height:22px;display:block;object-fit:contain;pointer-events:none}',
      '.dsh-rb-root[data-busy="true"] .dsh-rb-button{opacity:.6;pointer-events:none}',
      '.dsh-rb-root[data-busy="true"] .dsh-rb-button svg{animation:dsh-rb-spin 1s linear infinite}',
      '@keyframes dsh-rb-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
      '.dsh-rb-scrim{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;',
      'background:var(--dsw-alias-bg-mask-2,rgba(8,10,16,.5));backdrop-filter:blur(2px)}',
      '.dsh-rb-scrim[hidden]{display:none}',
      '.dsh-rb-card{width:min(360px,calc(100vw - 48px));padding:20px 20px 16px;border-radius:14px;color:inherit;',
      'background:var(--dsw-alias-bg-layer-3,rgba(28,32,41,.98));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));',
      'box-shadow:0 24px 60px var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.5));',
      "font:14px/1.6 var(--dsw-font-family-brand,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif)}",
      '.dsh-rb-title{font-size:15px;font-weight:600;margin:0 0 8px}',
      '.dsh-rb-text{margin:0 0 16px;opacity:.72}',
      '.dsh-rb-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.dsh-rb-btn{all:unset;padding:7px 16px;border-radius:8px;cursor:pointer;font-size:13px;transition:background .12s ease}',
      '.dsh-rb-btn:focus-visible{outline:2px solid #5090ff;outline-offset:2px}',
      '.dsh-rb-cancel{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.07));color:inherit}',
      '.dsh-rb-cancel:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12))}',
      '.dsh-rb-primary{color:#fff;background:#3d7bff}',
      '.dsh-rb-primary:hover{background:#5090ff}',
      '.dsh-rb-primary[disabled]{background:var(--dsw-alias-bg-layer-4,#3a4356);color:inherit;opacity:.6;cursor:default}',
    ].join('')

    /** Subscribers the settings card notifies after every save. */
    var listeners = []
    /** The last configuration handed to the floating button. */
    var current = null

    /** Hand a new configuration to every mounted surface. */
    function publish(config) {
      current = config
      for (var index = 0; index < listeners.length; index++) listeners[index](config)
    }

    /** Call one host endpoint. */
    function request(path, init) {
      return fetch(API + path, init).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    /** Read the whole configuration. */
    function loadConfig() {
      return request('/config', { headers: { accept: 'application/json' } })
    }

    /** Save a partial configuration and publish the merged result. */
    function saveConfig(patch) {
      return request('/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
        .then(function (answer) {
          publish(answer.config)
          return answer.config
        })
    }

    /** Upload one image as the custom icon. */
    function uploadIcon(dataUrl) {
      return request('/icon', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl: dataUrl }) })
        .then(function (answer) {
          publish(answer.config)
          return answer.config
        })
    }

    /** Pick readable foreground ink for one background colour. */
    function contrast(hex) {
      function channel(value) {
        var scaled = value / 255
        return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4)
      }
      var red = channel(parseInt(hex.slice(1, 3), 16))
      var green = channel(parseInt(hex.slice(3, 5), 16))
      var blue = channel(parseInt(hex.slice(5, 7), 16))
      var luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
      return luminance > 0.5 ? '#1b2030' : '#ffffff'
    }

    /** Markup of one glyph. */
    function glyph(id) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[id] || ICONS.rewind) + '</svg>'
    }

    /** Markup of the configured icon: a built-in glyph or the uploaded image. */
    function iconMarkup(config) {
      if (config.icon === 'custom') return '<img src="' + API + '/icon?v=' + config.customVersion + '" alt="">'
      return glyph(config.icon)
    }

    /** Inject the stylesheet once per document. */
    function ensureStyle() {
      if (document.getElementById('dsh-restart-button-style') !== null) return
      var style = document.createElement('style')
      style.id = 'dsh-restart-button-style'
      style.textContent = CSS
      document.head.append(style)
    }

    /** Clamp one inset so the button can never leave the viewport. */
    function clamp(value, max) {
      return Math.min(Math.max(Math.round(value), MARGIN), Math.max(MARGIN, max - SIZE - MARGIN))
    }

    /** Build the button, its confirm dialog, and the drag behaviour. */
    function mount() {
      var root = document.createElement('div')
      root.className = 'dsh-rb-root'
      root.style.right = MARGIN + 'px'
      root.style.bottom = MARGIN + 'px'

      var button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-rb-button'
      button.setAttribute('aria-label', '重启 DeepSeek Harness')
      button.innerHTML = glyph('rewind')
      root.append(button)

      var scrim = document.createElement('div')
      scrim.className = 'dsh-rb-scrim'
      scrim.hidden = true
      scrim.innerHTML = '<div class="dsh-rb-card" role="dialog" aria-modal="true" aria-labelledby="dsh-rb-title">' +
        '<div class="dsh-rb-title" id="dsh-rb-title">重启 DeepSeek Harness</div>' +
        '<p class="dsh-rb-text">将关闭应用与 Host 进程，并在约 2 秒后自动重新打开。正在进行中的回答会被中断，已保存的会话记录不受影响。</p>' +
        '<div class="dsh-rb-actions"><button type="button" class="dsh-rb-btn dsh-rb-cancel">取消</button>' +
        '<button type="button" class="dsh-rb-btn dsh-rb-primary">确认重启</button></div></div>'
      document.body.append(root, scrim)

      var cancel = scrim.querySelector('.dsh-rb-cancel')
      var confirm = scrim.querySelector('.dsh-rb-primary')
      // The page's own button reset outranks a class rule on some themes, so the
      // confirm button carries its colours inline.
      confirm.style.background = '#3d7bff'
      confirm.style.color = '#fff'
      var text = scrim.querySelector('.dsh-rb-text')
      var hint = text.textContent
      var dragging = false
      var moved = false
      var origin = null
      var inset = null
      var locked = false

      /** Place the button from its current insets. */
      function place(next) {
        inset = { right: clamp(next.right, window.innerWidth), bottom: clamp(next.bottom, window.innerHeight) }
        root.style.right = inset.right + 'px'
        root.style.bottom = inset.bottom + 'px'
      }

      /** Persist the insets the drag left behind. */
      function persist() {
        saveConfig(inset).catch(function () { /* the position is cosmetic */ })
      }

      /** Apply one configuration to the surface. */
      function apply(config) {
        if (config === null || typeof config !== 'object') return
        locked = config.locked === true
        root.dataset.locked = locked ? 'true' : 'false'
        button.title = locked ? '按钮位置已锁定，点击重启应用' : '拖动改变位置，点击重启应用'
        if (config.color === null) {
          button.style.background = ''
          button.style.color = ''
        } else {
          button.style.background = config.color
          button.style.color = contrast(config.color)
        }
        var markup = iconMarkup(config)
        if (button.innerHTML !== markup) button.innerHTML = markup
        if (inset === null || (config.right !== inset.right && !dragging) || (config.bottom !== inset.bottom && !dragging)) {
          place({ right: config.right, bottom: config.bottom })
        }
      }

      listeners.push(apply)
      if (current === null) loadConfig().then(apply, function () { /* keep the defaults */ })
      else apply(current)

      button.addEventListener('pointerdown', function (event) {
        if (event.button !== 0 || locked || root.dataset.busy === 'true') return
        event.preventDefault()
        origin = { x: event.clientX, y: event.clientY, right: inset.right, bottom: inset.bottom }
        moved = false
        dragging = true
        button.setPointerCapture(event.pointerId)
      })

      button.addEventListener('pointermove', function (event) {
        if (!dragging || origin === null) return
        var dx = event.clientX - origin.x
        var dy = event.clientY - origin.y
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
        moved = true
        root.dataset.dragging = 'true'
        place({ right: origin.right - dx, bottom: origin.bottom - dy })
      })

      button.addEventListener('pointerup', function (event) {
        if (!dragging) return
        dragging = false
        delete root.dataset.dragging
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId)
        if (moved) persist()
      })

      button.addEventListener('pointercancel', function () {
        dragging = false
        delete root.dataset.dragging
      })

      button.addEventListener('click', function (event) {
        if (moved) {
          moved = false
          event.preventDefault()
          return
        }
        open()
      })

      window.addEventListener('resize', function () {
        if (inset !== null) place(inset)
      })

      /** Show the confirmation dialog. */
      function open() {
        if (root.dataset.busy === 'true') return
        text.textContent = hint
        confirm.disabled = false
        confirm.style.background = '#3d7bff'
        confirm.textContent = '确认重启'
        scrim.hidden = false
        confirm.focus()
      }

      /** Hide the confirmation dialog. */
      function close() {
        scrim.hidden = true
      }

      /** Start the relaunch and keep the UI honest while the app goes away. */
      function restart() {
        confirm.disabled = true
        confirm.style.background = 'rgba(255,255,255,.12)'
        confirm.textContent = '正在重启…'
        text.textContent = '已发出重启指令，应用即将关闭并自动重新打开。'
        root.dataset.busy = 'true'
        request('/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(function (result) {
          if (result && result.ok === false) throw new Error(result.error || 'restart failed')
        }).catch(function (error) {
          root.dataset.busy = 'false'
          confirm.disabled = false
          confirm.style.background = '#3d7bff'
          confirm.textContent = '确认重启'
          text.textContent = '重启失败：' + (error && error.message ? error.message : String(error)) + '。可手动退出并重新打开应用。'
        })
      }

      function onKeydown(event) {
        if (event.key === 'Escape' && scrim.hidden === false) close()
      }

      cancel.addEventListener('click', close)
      confirm.addEventListener('click', restart)
      scrim.addEventListener('click', function (event) {
        if (event.target === scrim) close()
      })
      document.addEventListener('keydown', onKeydown)

      return {
        dispose: function () {
          document.removeEventListener('keydown', onKeydown)
          var seat = listeners.indexOf(apply)
          if (seat >= 0) listeners.splice(seat, 1)
          root.remove()
          scrim.remove()
        },
      }
    }

    /** One labelled settings row. */
    function row(label, control, hint) {
      return h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '10px 0', borderTop: '1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('span', { style: { fontSize: '13px' } }, label),
          hint === undefined ? null : h('span', { style: { fontSize: '12px', opacity: 0.6 } }, hint)),
        control)
    }

    /** One icon swatch inside the icon picker. */
    function swatch(config, id, onPick) {
      var selected = config.icon === id
      var content = id === 'custom' ? h('img', {
        src: API + '/icon?v=' + config.customVersion,
        alt: '',
        style: { width: '20px', height: '20px', objectFit: 'contain' },
      }) : h('span', { style: { display: 'block', width: '20px', height: '20px' }, dangerouslySetInnerHTML: { __html: glyph(id) } })
      return h('button', {
        key: id,
        type: 'button',
        title: ICON_LABELS[id],
        onClick: function () { onPick(id) },
        style: {
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          color: 'inherit',
          background: 'var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06))',
          border: selected ? '2px solid #3d7bff' : '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14))',
        },
      }, content)
    }

    /** The "重启按钮" settings page. */
    function SettingsSection() {
      var state = React.useState(null)
      var config = state[0]
      var setConfig = state[1]
      var status = React.useState('')
      var setStatus = status[1]
      var fileInput = React.useRef(null)

      React.useEffect(function () {
        var live = true
        loadConfig().then(function (value) { if (live) setConfig(value) }, function (error) {
          if (live) setStatus('读取配置失败：' + (error && error.message ? error.message : String(error)))
        })
        return function () { live = false }
      }, [])

      /** Persist one patch and mirror it into the card. */
      function update(patch) {
        setStatus('保存中…')
        saveConfig(patch).then(function (value) {
          setConfig(value)
          setStatus('已保存')
        }, function (error) {
          setStatus('保存失败：' + (error && error.message ? error.message : String(error)))
        })
      }

      /** Read the chosen file and upload it as the custom icon. */
      function pickFile(event) {
        var file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (file === undefined || file === null) return
        if (file.size > 2 * 1024 * 1024) {
          setStatus('图片需小于 2 MB')
          return
        }
        var reader = new FileReader()
        reader.onload = function () {
          setStatus('上传中…')
          uploadIcon(String(reader.result)).then(function (value) {
            setConfig(value)
            setStatus('已保存')
          }, function (error) {
            setStatus('上传失败：' + (error && error.message ? error.message : String(error)))
          })
        }
        reader.readAsDataURL(file)
      }

      if (config === null) {
        return h('div', { style: { padding: '8px 0', fontSize: '13px', opacity: 0.7 } }, status[0] === '' ? '读取中…' : status[0])
      }

      var iconRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        ICON_ORDER.map(function (id) { return swatch(config, id, function (picked) { update({ icon: picked }) }) }),
        config.icon === 'custom' ? swatch(config, 'custom', function () { /* already custom */ }) : null,
        h('button', {
          type: 'button',
          onClick: function () { if (fileInput.current !== null) fileInput.current.click() },
          style: {
            all: 'unset',
            cursor: 'pointer',
            padding: '7px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'inherit',
            background: 'var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06))',
            border: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14))',
          },
        }, '上传图片'),
        h('input', { key: 'file', ref: fileInput, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', style: { display: 'none' }, onChange: pickFile }))

      var colorRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('input', {
          type: 'color',
          value: config.color === null ? '#3a3f4b' : config.color,
          onChange: function (event) { update({ color: event.target.value }) },
          style: { width: '34px', height: '26px', padding: '0', border: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14))', borderRadius: '6px', background: 'transparent', cursor: 'pointer' },
        }),
        h('button', {
          type: 'button',
          onClick: function () { update({ color: null }) },
          disabled: config.color === null,
          style: {
            all: 'unset',
            cursor: config.color === null ? 'default' : 'pointer',
            padding: '5px 10px',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'inherit',
            opacity: config.color === null ? 0.45 : 1,
            background: 'var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06))',
            border: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14))',
          },
        }, '跟随主题'))

      var lockRow = h('input', {
        type: 'checkbox',
        checked: config.locked === true,
        onChange: function (event) { update({ locked: event.target.checked }) },
        style: { width: '18px', height: '18px', cursor: 'pointer', accentColor: '#3d7bff' },
      })

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: 'inherit', maxWidth: '620px' } },
        h('p', { style: { margin: '0 0 8px', opacity: 0.72, fontSize: '13px', lineHeight: 1.6 } },
          '屏幕右下角的悬浮重启按钮：拖动改变位置，点击弹出确认框。这里的设置会立即生效。'),
        row('图标', iconRow, '自带 4 个矢量图标，也可以上传本地图片（PNG / JPG / WebP / GIF / SVG，≤ 2 MB）'),
        row('底色', colorRow, '未指定时跟随界面主题：浅色界面为灰白，深色界面为灰黑'),
        row('锁定位置', lockRow, '锁定后按钮不能再拖动，点击重启仍然可用'),
        h('div', { style: { minHeight: '18px', fontSize: '12px', opacity: 0.6, paddingTop: '8px' } }, status[0]))
    }

    /** Mount the floating surface and the settings page while the plugin stays loaded. */
    function apply(ctx) {
      ctx.effect(function () {
        ensureStyle()
        var surface = mount()
        return function () {
          surface.dispose()
        }
      }, 'restart-button: overlay')
      // The slot type belongs to the settings shell, which may register later than
      // this plugin: slots.inject waits for it instead of registering blind.
      ctx.effect(function () {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'restart-button',
            order: 240,
            label: function () { return '重启按钮' },
            inject: function () { return {} },
          }, SettingsSection)
        })
      }, 'restart-button: settings section')
    }

    exports.apply = apply
    // 'slots' is the renderer's slot registry; without it ctx.slots is absent at apply time.
    exports.inject = ['slots']
    return module.exports
  },
})
