// 全站悬浮播放器：进入任意页面立即随机播放（不重复）
// 歌单来自 /json/music_config.json
// 浏览器拦截有声自动播放时先静音播放，用户首次交互后自动恢复声音
// 使用 sessionStorage 在页面切换（含 pjax 完整加载）时保持播放进度
// 二级菜单：进度条、音量、歌词（歌词默认常驻，可切换显示）
(function () {
  'use strict';

  var ICON_PLAY = '<i class="fas fa-play"></i>';
  var ICON_PAUSE = '<i class="fas fa-pause"></i>';
  var ICON_MUTE = '<i class="fas fa-volume-slash"></i>';
  var STATE_KEY = 'musicFloatState';

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // 兜底：JSON 配置加载失败时，读取音乐页胶囊数据
  function getCardPlaylist() {
    var playlist = [];
    var cards = document.querySelectorAll('.music-card[data-src]');
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      playlist.push({
        name: el.getAttribute('data-name') || '未知歌曲',
        artist: el.getAttribute('data-artist') || '',
        cover: el.getAttribute('data-cover') || '',
        src: el.getAttribute('data-src')
      });
    }
    return playlist.filter(function (s) { return s.src; });
  }

  function loadState() {
    try {
      var raw = sessionStorage.getItem(STATE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.src ? s : null;
    } catch (e) {
      return null;
    }
  }

  function formatTime(sec) {
    sec = Math.floor(sec || 0);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 把带时间戳的 lrc 文本解析为 [{ time, text }]，时间单位为秒
  function parseLrc(text) {
    var lines = text.split(/\r?\n/);
    var result = [];
    var tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var times = [];
      var m;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(line))) {
        var min = parseInt(m[1], 10);
        var sec = parseInt(m[2], 10);
        var frac = m[3] ? parseInt(m[3], 10) : 0;
        // 两位小数（如 .20）表示百分秒，需换算为毫秒
        if (m[3] && m[3].length === 2) frac *= 10;
        times.push(min * 60 + sec + frac / 1000);
      }
      var pure = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!pure) continue;
      // 过滤制作者信息 / “歌名 - 歌手” 标题行
      if (isMetadataLine(pure)) continue;
      for (var t = 0; t < times.length; t++) {
        result.push({ time: times[t], text: pure });
      }
    }
    result.sort(function (a, b) { return a.time - b.time; });
    return result;
  }

  function isMetadataLine(t) {
    // 含冒号（作词：/Composer: 等）或 “ - ” 分隔的标题行，视为非歌词行
    return /[：:]/.test(t) || /\s-\s/.test(t);
  }

  function init() {
    if (document.querySelector('.music-float')) return;

    // 优先加载独立 JSON 配置文件；失败则回退到音乐页胶囊数据
    fetch('/json/music_config.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(startPlayer)
      .catch(function () { startPlayer(getCardPlaylist()); });
  }

  function startPlayer(playlist) {
    if (!playlist || !playlist.length) return;

    var saved = loadState();

    // 随机打乱播放顺序，保证一轮内不重复；若恢复则定位到上次播放的歌曲
    var queue = shuffle(playlist);
    var index = 0;
    var resumeTime = 0;
    if (saved) {
      for (var k = 0; k < playlist.length; k++) {
        if (playlist[k].src === saved.src) {
          queue = shuffle(playlist);
          index = k;
          // 把恢复的歌曲挪到队首，保持后续继续随机不重复
          var pos = queue.indexOf(playlist[k]);
          if (pos > 0) {
            var tmp = queue[0];
            queue[0] = queue[pos];
            queue[pos] = tmp;
          }
          index = 0;
          resumeTime = saved.time || 0;
          break;
        }
      }
    }

    var audio = new Audio();
    // 音乐页自带原生播放器，悬浮播放器在此不预加载，避免大体积音频拖慢页面加载
    var isMusicPage = !!document.querySelector('.music-card');
    audio.preload = isMusicPage ? 'none' : 'auto';
    audio.volume = (saved && typeof saved.volume === 'number') ? saved.volume : 1;

    // ---- 构建悬浮窗 DOM ----
    var box = document.createElement('div');
    box.className = 'music-float';
    // 关键内联兜底：即使外部 CSS 延迟/未加载，也保证悬浮窗固定定位、不参与文档流撑破页面布局
    box.style.position = 'fixed';
    box.style.left = '16px';
    box.style.bottom = '16px';
    box.style.zIndex = '1000';
    box.innerHTML =
      '<div class="music-float-main">' +
        '<div class="music-float-top">' +
          '<div class="music-float-cover">' +
            '<img alt="cover" width="44" height="44">' +
          '</div>' +
          '<div class="music-float-info">' +
            '<div class="music-float-title"></div>' +
            '<div class="music-float-artist"></div>' +
          '</div>' +
        '</div>' +
        '<div class="music-float-ctrl">' +
          '<button type="button" class="mf-btn mf-prev" title="上一首"><i class="fas fa-step-backward"></i></button>' +
          '<button type="button" class="mf-btn mf-toggle" title="播放/暂停">' + ICON_PAUSE + '</button>' +
          '<button type="button" class="mf-btn mf-next" title="下一首"><i class="fas fa-step-forward"></i></button>' +
          '<button type="button" class="mf-btn mf-menu" title="二级菜单"><i class="fas fa-chevron-down"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="music-float-panel">' +
        '<div class="music-float-panel-inner">' +
          '<div class="mf-row mf-progress">' +
            '<span class="mf-time mf-time-cur">0:00</span>' +
            '<div class="mf-progress-track"><div class="mf-progress-fill"></div></div>' +
            '<span class="mf-time mf-time-dur">0:00</span>' +
          '</div>' +
          '<div class="mf-row mf-volume">' +
            '<button type="button" class="mf-btn mf-mute" title="静音/取消静音"><i class="fas fa-volume"></i></button>' +
            '<div class="mf-volume-track"><div class="mf-volume-fill"></div></div>' +
          '</div>' +
          '<div class="mf-lyrics">' +
            '<div class="mf-lyrics-head">' +
              '<span>歌词</span>' +
              '<button type="button" class="mf-lyrics-toggle" title="显示/隐藏歌词"><i class="fas fa-eye"></i></button>' +
            '</div>' +
            '<div class="mf-lyrics-body"><div class="mf-lyrics-empty">加载中…</div></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var coverImg = box.querySelector('.music-float-cover img');
    var titleEl = box.querySelector('.music-float-title');
    var artistEl = box.querySelector('.music-float-artist');
    var btnToggle = box.querySelector('.mf-toggle');
    var btnPrev = box.querySelector('.mf-prev');
    var btnNext = box.querySelector('.mf-next');
    var btnMenu = box.querySelector('.mf-menu');
    var btnMute = box.querySelector('.mf-mute');
    var btnLyricsToggle = box.querySelector('.mf-lyrics-toggle');
    var lyricsToggleIcon = btnLyricsToggle.querySelector('i');
    var lyricsBodyEl = box.querySelector('.mf-lyrics-body');
    // 歌词区高度兜底：无外部 CSS 时也不会一次性展开所有歌词行把悬浮窗撑高
    lyricsBodyEl.style.maxHeight = '120px';
    lyricsBodyEl.style.overflowY = 'auto';
    var progressTrack = box.querySelector('.mf-progress-track');
    var progressFill = box.querySelector('.mf-progress-fill');
    var timeCur = box.querySelector('.mf-time-cur');
    var timeDur = box.querySelector('.mf-time-dur');
    var volumeTrack = box.querySelector('.mf-volume-track');
    var volumeFill = box.querySelector('.mf-volume-fill');

    var lyricsCache = {};
    var currentLyrics = [];
    var currentLrcUrl = null;
    var currentLineIdx = -1;

    updateVolumeUI();

    if (saved && saved.lyricsHidden) {
      box.classList.add('lyrics-hidden');
    }
    updateLyricsToggleIcon();

    function updateLyricsToggleIcon() {
      var hidden = box.classList.contains('lyrics-hidden');
      lyricsToggleIcon.className = 'fas ' + (hidden ? 'fa-eye-slash' : 'fa-eye');
    }

    function render() {
      var song = queue[index];
      titleEl.textContent = song.name;
      artistEl.textContent = song.artist;
      if (song.cover) {
        coverImg.src = song.cover;
        coverImg.style.display = '';
      } else {
        coverImg.style.display = 'none';
      }
      loadLyrics(song);
    }

    function applyLyrics(lines) {
      currentLyrics = lines;
      currentLineIdx = -1;
      if (!lines.length) {
        lyricsBodyEl.innerHTML = '<div class="mf-lyrics-empty">暂无歌词</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        html += '<div class="mf-lyrics-line" data-i="' + i + '">' + escapeHtml(lines[i].text) + '</div>';
      }
      lyricsBodyEl.innerHTML = html;
    }

    function loadLyrics(song) {
      currentLrcUrl = song.lrc || null;
      if (!currentLrcUrl) {
        currentLyrics = [];
        currentLineIdx = -1;
        lyricsBodyEl.innerHTML = '<div class="mf-lyrics-empty">暂无歌词</div>';
        return;
      }
      if (lyricsCache[currentLrcUrl]) {
        applyLyrics(lyricsCache[currentLrcUrl]);
        return;
      }
      lyricsBodyEl.innerHTML = '<div class="mf-lyrics-empty">歌词加载中…</div>';
      fetch(currentLrcUrl)
        .then(function (r) { return r.text(); })
        .then(function (text) {
          var parsed = parseLrc(text);
          lyricsCache[currentLrcUrl] = parsed;
          // 异步返回时可能已切歌，仅当仍是当前歌曲时应用
          if (currentLrcUrl === song.lrc) applyLyrics(parsed);
        })
        .catch(function () {
          if (currentLrcUrl === song.lrc) {
            currentLyrics = [];
            currentLineIdx = -1;
            lyricsBodyEl.innerHTML = '<div class="mf-lyrics-empty">歌词加载失败</div>';
          }
        });
    }

    function syncLyrics() {
      if (!currentLyrics.length) return;
      var t = audio.currentTime || 0;
      var idx = -1;
      for (var i = 0; i < currentLyrics.length; i++) {
        if (currentLyrics[i].time <= t + 0.3) idx = i;
        else break;
      }
      if (idx === currentLineIdx) return;
      currentLineIdx = idx;
      var lines = lyricsBodyEl.querySelectorAll('.mf-lyrics-line');
      for (var j = 0; j < lines.length; j++) lines[j].classList.remove('active');
      if (idx >= 0) {
        var el = lines[idx];
        el.classList.add('active');
        lyricsBodyEl.scrollTop = el.offsetTop - lyricsBodyEl.clientHeight / 2 + el.clientHeight / 2;
      }
    }

    function updateProgress() {
      var dur = audio.duration || 0;
      var cur = audio.currentTime || 0;
      if (dur > 0) {
        progressFill.style.width = (cur / dur * 100) + '%';
      }
      timeCur.textContent = formatTime(cur);
      timeDur.textContent = dur > 0 ? formatTime(dur) : '0:00';
    }

    function updateVolumeUI() {
      var v = (audio.muted || audio.volume === 0) ? 0 : audio.volume;
      btnMute.querySelector('i').className = 'fas ' + (v === 0 ? 'fa-volume-slash' : 'fa-volume');
      volumeFill.style.width = (v * 100) + '%';
    }

    function loadAndPlay(seekTo) {
      var song = queue[index];
      audio.src = song.src;
      render();
      audio.muted = false;
      updateVolumeUI();
      var start = function () {
        if (seekTo > 0) {
          try { audio.currentTime = seekTo; } catch (e) {}
        }
        updateProgress();
      };
      audio.play().then(function () {
        start();
        btnToggle.innerHTML = ICON_PAUSE;
        btnToggle.title = '暂停';
        box.classList.add('playing');
        box.classList.remove('muted');
      }).catch(function () {
        // 有声自动播放被拦截：降级为静音播放（仍立即开始）
        audio.muted = true;
        audio.play().then(function () {
          start();
          btnToggle.innerHTML = ICON_MUTE;
          btnToggle.title = '静音播放中，点击开启声音';
          box.classList.add('playing');
          box.classList.add('muted');
          updateVolumeUI();
        }).catch(function () {
          btnToggle.innerHTML = ICON_PLAY;
          btnToggle.title = '播放';
          box.classList.remove('playing');
        });
      });
    }

    function playNext() {
      index = (index + 1) % queue.length;
      loadAndPlay(0);
    }

    function playPrev() {
      index = (index - 1 + queue.length) % queue.length;
      loadAndPlay(0);
    }

    btnToggle.addEventListener('click', function () {
      if (audio.paused) {
        if (!audio.src) {
          // 音乐页首次点击播放：先加载音频源再播放（若有历史进度则恢复）
          loadAndPlay(resumeTime);
          return;
        }
        audio.muted = false;
        audio.play().then(function () {
          btnToggle.innerHTML = ICON_PAUSE;
          btnToggle.title = '暂停';
          box.classList.add('playing');
          updateVolumeUI();
        }).catch(function () {});
      } else if (audio.muted) {
        // 静音播放中点击：恢复声音
        audio.muted = false;
        btnToggle.innerHTML = ICON_PAUSE;
        btnToggle.title = '暂停';
        box.classList.remove('muted');
        updateVolumeUI();
      } else {
        audio.pause();
        btnToggle.innerHTML = ICON_PLAY;
        btnToggle.title = '播放';
        box.classList.remove('playing');
      }
    });

    btnPrev.addEventListener('click', playPrev);
    btnNext.addEventListener('click', playNext);

    // 二级菜单展开/收起
    btnMenu.addEventListener('click', function () {
      box.classList.toggle('panel-open');
      btnMenu.classList.toggle('active');
    });

    // 歌词显示/隐藏（默认常驻）
    btnLyricsToggle.addEventListener('click', function () {
      box.classList.toggle('lyrics-hidden');
      updateLyricsToggleIcon();
    });

    // 静音/取消静音
    btnMute.addEventListener('click', function () {
      if (audio.muted || audio.volume === 0) {
        audio.muted = false;
        if (audio.volume === 0) audio.volume = 1;
      } else {
        audio.muted = true;
      }
      updateVolumeUI();
    });

    // 音量滑块
    bindDragSeek(volumeTrack, function (ratio) {
      audio.volume = ratio;
      audio.muted = false;
      updateVolumeUI();
    });

    // 进度条：点击 / 拖动跳转
    function bindDragSeek(el, onRatio) {
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var dragging = true;
        function apply(ev) {
          var rect = el.getBoundingClientRect();
          var ratio = (ev.clientX - rect.left) / rect.width;
          ratio = Math.max(0, Math.min(1, ratio));
          onRatio(ratio);
        }
        apply(e);
        function move(ev) { if (dragging) apply(ev); }
        function up() {
          dragging = false;
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
        }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      });
    }
    bindDragSeek(progressTrack, function (ratio) {
      if (!audio.duration) return;
      audio.currentTime = ratio * audio.duration;
      updateProgress();
    });

    // 收起/显示悬浮窗：由齿轮菜单中的音乐按钮切换（pjax 会替换它，故用事件委托）
    function syncRestoreButton() {
      var btn = document.querySelector('#mf-restore');
      if (!btn) return;
      var collapsed = box.classList.contains('collapsed');
      btn.title = collapsed ? '显示音乐' : '收起音乐';
      var icon = btn.querySelector('i');
      if (icon) icon.className = 'fas ' + (collapsed ? 'fa-music-slash' : 'fa-music');
    }
    document.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('#mf-restore') : null;
      if (!btn) return;
      box.classList.toggle('collapsed');
      syncRestoreButton();
    });
    document.addEventListener('pjax:complete', syncRestoreButton);

    audio.addEventListener('ended', function () {
      // 一轮放完后重新打乱，并避免与上一首重复
      if (index === queue.length - 1) {
        var last = queue[index];
        var next = shuffle(playlist);
        if (next.length > 1 && next[0].src === last.src) {
          var t = next[0];
          next[0] = next[1];
          next[1] = t;
        }
        queue = next;
        index = 0;
      } else {
        index++;
      }
      loadAndPlay(0);
    });

    audio.addEventListener('timeupdate', function () {
      updateProgress();
      syncLyrics();
    });

    // 首次交互（点击/触摸/键盘/滚动）时自动恢复声音，解决浏览器自动播放限制
    function tryUnmute() {
      if (audio.muted && !audio.paused) {
        audio.muted = false;
        btnToggle.innerHTML = ICON_PAUSE;
        btnToggle.title = '暂停';
        box.classList.remove('muted');
        updateVolumeUI();
      }
    }
    ['pointerdown', 'keydown', 'touchstart', 'click', 'scroll'].forEach(function (type) {
      window.addEventListener(type, tryUnmute, { passive: true });
    });

    document.body.appendChild(box);

    // ---- 拖动位置 + 九宫格吸附（四角 / 四边 / 中央区域） ----
    var EDGE_GAP = 16;
    var drag = null;

    function setPos(left, top) {
      box.style.left = left + 'px';
      box.style.top = top + 'px';
      box.style.right = 'auto';
      box.style.bottom = 'auto';
    }

    function clampBox() {
      var rect = box.getBoundingClientRect();
      var left = Math.max(0, Math.min(rect.left, window.innerWidth - rect.width));
      var top = Math.max(0, Math.min(rect.top, window.innerHeight - rect.height));
      if (left !== rect.left || top !== rect.top) setPos(left, top);
    }

    // 九宫格吸附：四角 / 四边中部各自吸附，中央区域保持原位不被吸走
    function snapToZone() {
      var rect = box.getBoundingClientRect();
      var w = window.innerWidth;
      var h = window.innerHeight;
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;

      var zoneX = cx < w / 3 ? 'left' : (cx > w * 2 / 3 ? 'right' : 'center');
      var zoneY = cy < h / 3 ? 'top' : (cy > h * 2 / 3 ? 'bottom' : 'center');

      // 四角 / 四边：x、y 各自吸附；中央区域（center/center）两个坐标都保持不变
      var left = rect.left;
      var top = rect.top;
      if (zoneX === 'left') left = EDGE_GAP;
      if (zoneX === 'right') left = w - rect.width - EDGE_GAP;
      if (zoneY === 'top') top = EDGE_GAP;
      if (zoneY === 'bottom') top = h - rect.height - EDGE_GAP;

      box.classList.add('snapping');
      setPos(left, top);
      setTimeout(function () { box.classList.remove('snapping'); }, 300);
    }

    box.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button, input, .mf-progress-track, .mf-volume-track, .mf-lyrics-body')) return;
      box.classList.remove('snapping');
      box.classList.add('dragging');
      var rect = box.getBoundingClientRect();
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        originLeft: rect.left,
        originTop: rect.top,
        moved: false
      };
      box.setPointerCapture(e.pointerId);
    });

    box.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.startX;
      var dy = e.clientY - drag.startY;
      if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) drag.moved = true;
      if (!drag.moved) return;
      var left = Math.max(0, Math.min(drag.originLeft + dx, window.innerWidth - box.offsetWidth));
      var top = Math.max(0, Math.min(drag.originTop + dy, window.innerHeight - box.offsetHeight));
      setPos(left, top);
    });

    function endDrag() {
      if (!drag) return;
      var wasDrag = drag.moved;
      drag = null;
      box.classList.remove('dragging');
      if (wasDrag) snapToZone();
    }

    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', function () {
      drag = null;
      box.classList.remove('dragging');
    });

    if (isMusicPage) {
      // 音乐页仅显示悬浮窗（暂停状态），首次点击播放时才加载音频
      render();
      btnToggle.innerHTML = ICON_PLAY;
      btnToggle.title = '播放';
      box.classList.remove('playing');
    } else {
      loadAndPlay(resumeTime);
    }

    updateVolumeUI();

    // 二级菜单展开时若超出屏幕，自动回收到可视区域
    var panelObserver = null;
    if (typeof MutationObserver !== 'undefined') {
      panelObserver = new MutationObserver(function () {
        if (box.classList.contains('panel-open')) clampBox();
      });
      panelObserver.observe(box, { attributes: true, attributeFilter: ['class'] });
    }

    // 页面离开前保存进度与偏好，保证进入音乐页等 pjax 完整加载页面时不重置
    function saveState() {
      try {
        var song = queue[index];
        if (!song) return;
        sessionStorage.setItem(STATE_KEY, JSON.stringify({
          src: song.src,
          time: audio.currentTime || 0,
          playing: !audio.paused,
          muted: audio.muted,
          volume: audio.volume,
          lyricsHidden: box.classList.contains('lyrics-hidden')
        }));
      } catch (e) {}
    }
    window.addEventListener('pagehide', saveState);
    window.addEventListener('beforeunload', saveState);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();