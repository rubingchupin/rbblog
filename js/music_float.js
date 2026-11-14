// 全站悬浮播放器：进入任意页面立即随机播放（不重复）
// 歌单来自 /js/music_config.js（window.MUSIC_PLAYLIST）
// 浏览器拦截有声自动播放时先静音播放，用户首次交互后自动恢复声音
// 使用 sessionStorage 在页面切换（含 pjax 完整加载）时保持播放进度
(function () {
  'use strict';

  var ICON_PLAY = '<i class="fas fa-play"></i>';
  var ICON_PAUSE = '<i class="fas fa-pause"></i>';
  var ICON_MUTE = '<i class="fas fa-volume-mute"></i>';
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

  function getPlaylist() {
    // 1. 优先使用独立配置文件
    if (window.MUSIC_PLAYLIST && window.MUSIC_PLAYLIST.length) {
      return window.MUSIC_PLAYLIST.slice();
    }
    // 2. 兜底：读取音乐页胶囊数据
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

  function init() {
    if (document.querySelector('.music-float')) return;

    var playlist = getPlaylist();
    if (!playlist.length) return;

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
    audio.preload = 'auto';

    // ---- 构建悬浮窗 DOM ----
    var box = document.createElement('div');
    box.className = 'music-float';
    box.innerHTML =
      '<div class="music-float-cover">' +
        '<img alt="cover">' +
      '</div>' +
      '<div class="music-float-info">' +
        '<div class="music-float-title"></div>' +
        '<div class="music-float-artist"></div>' +
      '</div>' +
      '<div class="music-float-ctrl">' +
        '<button type="button" class="mf-btn mf-prev" title="上一首"><i class="fas fa-step-backward"></i></button>' +
        '<button type="button" class="mf-btn mf-toggle" title="播放/暂停">' + ICON_PAUSE + '</button>' +
        '<button type="button" class="mf-btn mf-next" title="下一首"><i class="fas fa-step-forward"></i></button>' +
      '</div>';

    var coverImg = box.querySelector('.music-float-cover img');
    var titleEl = box.querySelector('.music-float-title');
    var artistEl = box.querySelector('.music-float-artist');
    var btnToggle = box.querySelector('.mf-toggle');
    var btnPrev = box.querySelector('.mf-prev');
    var btnNext = box.querySelector('.mf-next');

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
    }

    function loadAndPlay(seekTo) {
      var song = queue[index];
      audio.src = song.src;
      render();
      audio.muted = false;
      var start = function () {
        if (seekTo > 0) {
          try { audio.currentTime = seekTo; } catch (e) {}
        }
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
        audio.muted = false;
        audio.play().then(function () {
          btnToggle.innerHTML = ICON_PAUSE;
          btnToggle.title = '暂停';
          box.classList.add('playing');
        }).catch(function () {});
      } else if (audio.muted) {
        // 静音播放中点击：恢复声音
        audio.muted = false;
        btnToggle.innerHTML = ICON_PAUSE;
        btnToggle.title = '暂停';
        box.classList.remove('muted');
      } else {
        audio.pause();
        btnToggle.innerHTML = ICON_PLAY;
        btnToggle.title = '播放';
        box.classList.remove('playing');
      }
    });

    btnPrev.addEventListener('click', playPrev);
    btnNext.addEventListener('click', playNext);

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

    // 首次交互（点击/触摸/键盘/滚动）时自动恢复声音，解决浏览器自动播放限制
    function tryUnmute() {
      if (audio.muted && !audio.paused) {
        audio.muted = false;
        btnToggle.innerHTML = ICON_PAUSE;
        btnToggle.title = '暂停';
        box.classList.remove('muted');
      }
    }
    ['pointerdown', 'keydown', 'touchstart', 'click', 'scroll'].forEach(function (type) {
      window.addEventListener(type, tryUnmute, { passive: true });
    });

    document.body.appendChild(box);
    loadAndPlay(resumeTime);

    // 页面离开前保存进度，保证进入音乐页等 pjax 完整加载页面时不重置
    function saveState() {
      try {
        var song = queue[index];
        if (!song) return;
        sessionStorage.setItem(STATE_KEY, JSON.stringify({
          src: song.src,
          time: audio.currentTime || 0,
          playing: !audio.paused,
          muted: audio.muted
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