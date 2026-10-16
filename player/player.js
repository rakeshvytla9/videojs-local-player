/**
 * VideoJS Local Player - Player Logic
 * Handles drag-and-drop, file loading, playlist management,
 * and Video.js player initialization.
 */

(function () {
  'use strict';

  // ===== State =====
  let player = null;
  let audioContext = null;
  let audioSource = null;
  let rumbleFilter = null;
  let levelCompressor = null;
  let boostGain = null;
  let peakLimiter = null;
  const playlist = []; // { file: File, blobUrl: string, name: string, size: number }
  let currentIndex = -1;
  const BOOST_STORAGE_KEY = 'videojs-volume-boost';
  const DEFAULT_BOOST = 100;

  // ===== DOM Elements =====
  const dropZone = document.getElementById('drop-zone');
  const playerContainer = document.getElementById('player-container');
  const fileInput = document.getElementById('file-input');
  const videoTitle = document.getElementById('video-title');
  const videoMeta = document.getElementById('video-meta');
  const backBtn = document.getElementById('back-btn');
  const pipBtn = document.getElementById('pip-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const playlistItems = document.getElementById('playlist-items');
  const addMoreBtn = document.getElementById('add-more-btn');
  const playlistFileInput = document.getElementById('playlist-file-input');
  const volumeBoostSlider = document.getElementById('volume-boost-slider');
  const volumeBoostValue = document.getElementById('volume-boost-value');
  const volumeBoostReset = document.getElementById('volume-boost-reset');

  // ===== Utilities =====
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getFileExtension(name) {
    return name.split('.').pop().toUpperCase();
  }

  function getMimeType(file) {
    // Map common extensions to mime types for Video.js
    const ext = file.name.split('.').pop().toLowerCase();
    const mimeMap = {
      'mp4': 'video/mp4',
      'm4v': 'video/mp4',
      'webm': 'video/webm',
      'ogv': 'video/ogg',
      'ogg': 'video/ogg',
      'mov': 'video/mp4',
      'mkv': 'video/x-matroska',
      'avi': 'video/x-msvideo',
      'flv': 'video/x-flv',
      'wmv': 'video/x-ms-wmv',
      '3gp': 'video/3gpp',
      'ts': 'video/mp2t'
    };
    return mimeMap[ext] || file.type || 'video/mp4';
  }

  function showToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  // ===== Volume Boost =====
  function getSavedBoost() {
    const saved = Number(localStorage.getItem(BOOST_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= 100 && saved <= 400
      ? saved
      : DEFAULT_BOOST;
  }

  function ensureAudioGraph() {
    if (boostGain || !player) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      volumeBoostSlider.disabled = true;
      showToast('Volume boost is not supported in this browser');
      return;
    }

    try {
      audioContext = new AudioContextClass();
      audioSource = audioContext.createMediaElementSource(player);
      rumbleFilter = audioContext.createBiquadFilter();
      levelCompressor = audioContext.createDynamicsCompressor();
      boostGain = audioContext.createGain();
      peakLimiter = audioContext.createDynamicsCompressor();

      // Remove sub-bass rumble that is mostly inaudible but consumes valuable
      // headroom once the signal is amplified.
      rumbleFilter.type = 'highpass';
      rumbleFilter.frequency.value = 30;
      rumbleFilter.Q.value = 0.707;

      // Gently control the source before applying makeup gain. The threshold
      // is adjusted for the selected boost in setVolumeBoost().
      levelCompressor.threshold.value = 0;
      levelCompressor.knee.value = 6;
      levelCompressor.ratio.value = 4;
      levelCompressor.attack.value = 0.008;
      levelCompressor.release.value = 0.18;

      // Catch any remaining transients before they hard-clip at the output.
      peakLimiter.threshold.value = -1;
      peakLimiter.knee.value = 0;
      peakLimiter.ratio.value = 20;
      peakLimiter.attack.value = 0.001;
      peakLimiter.release.value = 0.08;

      audioSource.connect(rumbleFilter);
      rumbleFilter.connect(levelCompressor);
      levelCompressor.connect(boostGain);
      boostGain.connect(peakLimiter);
      peakLimiter.connect(audioContext.destination);
      boostGain.gain.value = Number(volumeBoostSlider.value) / 100;
    } catch (err) {
      volumeBoostSlider.disabled = true;
      showToast('Could not initialize volume boost');
    }
  }

  function resumeAudioContext() {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  }

  function setVolumeBoost(percent, announce) {
    const boost = Math.min(400, Math.max(100, Number(percent) || DEFAULT_BOOST));
    volumeBoostSlider.value = boost;
    volumeBoostValue.value = `${boost}%`;
    volumeBoostValue.textContent = `${boost}%`;
    volumeBoostReset.classList.toggle('visible', boost !== DEFAULT_BOOST);
    localStorage.setItem(BOOST_STORAGE_KEY, String(boost));

    // Leave normal 100% playback on the browser's native audio path until the
    // user actually requests amplification.
    if (boost !== DEFAULT_BOOST || boostGain) ensureAudioGraph();
    if (boostGain && audioContext) {
      const boostDecibels = 20 * Math.log10(boost / 100);
      boostGain.gain.setTargetAtTime(boost / 100, audioContext.currentTime, 0.015);

      // Preserve full gain for quiet passages while progressively controlling
      // material that would exceed the available headroom.
      levelCompressor.threshold.setTargetAtTime(
        boost === DEFAULT_BOOST ? 0 : -(boostDecibels + 3),
        audioContext.currentTime,
        0.02
      );

      // At 100%, keep the final limiter effectively transparent.
      peakLimiter.threshold.setTargetAtTime(
        boost === DEFAULT_BOOST ? 0 : -1,
        audioContext.currentTime,
        0.015
      );
      resumeAudioContext();
    }

    if (announce) {
      showToast(boost === DEFAULT_BOOST ? 'Volume boost reset' : `Volume boost: ${boost}%`);
    }
  }

  // ===== Video.js Player Initialization =====
  function initPlayer() {
    if (player) return;

    player = document.getElementById('videojs-player');
    setVolumeBoost(getSavedBoost(), false);

    // Auto-play next video when current ends
    player.addEventListener('ended', () => {
      if (currentIndex < playlist.length - 1) {
        playVideo(currentIndex + 1);
        showToast('Playing next video');
      }
    });

    // Update title on loadedmetadata
    player.addEventListener('loadedmetadata', () => {
      const duration = player.duration;
      const width = player.videoWidth;
      const height = player.videoHeight;
      const parts = [];
      if (width && height) parts.push(`${width}×${height}`);
      if (duration) {
        const mins = Math.floor(duration / 60);
        const secs = Math.floor(duration % 60);
        parts.push(`${mins}:${secs.toString().padStart(2, '0')}`);
      }
      if (playlist[currentIndex]) {
        parts.push(formatFileSize(playlist[currentIndex].size));
        parts.push(getFileExtension(playlist[currentIndex].name));
      }
      videoMeta.textContent = parts.join(' • ');
    });
  }

  // ===== Load & Play Video =====
  function playVideo(index) {
    if (index < 0 || index >= playlist.length) return;

    const item = playlist[index];
    currentIndex = index;

    // Update video element source
    player.src = item.blobUrl;

    // Update title
    videoTitle.textContent = item.name;
    videoMeta.textContent = formatFileSize(item.size);
    document.title = `▶ ${item.name} — VideoJS Player`;

    // Auto-play
    player.play().catch(() => {
      // Autoplay blocked, user will click play
    });

    // Update playlist UI
    updatePlaylistUI();
  }

  // ===== Add Files to Playlist =====
  function addFiles(files) {
    const videoFiles = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      const videoExts = ['mp4', 'webm', 'ogv', 'ogg', 'm4v', 'mov', 'avi', 'mkv', 'flv', 'wmv', '3gp', 'ts'];
      return f.type.startsWith('video/') || videoExts.includes(ext);
    });

    if (videoFiles.length === 0) {
      showToast('No valid video files found');
      return;
    }

    const startIndex = playlist.length;

    videoFiles.forEach(file => {
      const blobUrl = URL.createObjectURL(file);
      playlist.push({
        file: file,
        blobUrl: blobUrl,
        name: file.name,
        size: file.size
      });
    });

    // Initialize player if not already done
    initPlayer();

    // Show player, hide drop zone
    dropZone.style.display = 'none';
    playerContainer.classList.remove('hidden');

    // Play first added video if nothing is playing
    if (currentIndex === -1) {
      playVideo(startIndex);
    }

    updatePlaylistUI();

    if (videoFiles.length > 1) {
      showToast(`Added ${videoFiles.length} videos to playlist`);
    }
  }

  // ===== Update Playlist UI =====
  function updatePlaylistUI() {
    playlistItems.innerHTML = '';

    playlist.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'playlist-item' + (index === currentIndex ? ' active' : '');
      el.innerHTML = `
        <div class="playlist-item-icon">▶</div>
        <div class="playlist-item-info">
          <div class="playlist-item-name" title="${item.name}">${item.name}</div>
          <div class="playlist-item-size">${formatFileSize(item.size)} • ${getFileExtension(item.name)}</div>
        </div>
        <button class="playlist-item-remove" title="Remove">✕</button>
      `;

      // Play on click
      el.addEventListener('click', (e) => {
        if (e.target.closest('.playlist-item-remove')) return;
        playVideo(index);
      });

      // Remove from playlist
      el.querySelector('.playlist-item-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromPlaylist(index);
      });

      playlistItems.appendChild(el);
    });

    // Scroll active item into view
    const activeEl = playlistItems.querySelector('.playlist-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  // ===== Remove from Playlist =====
  function removeFromPlaylist(index) {
    // Revoke blob URL
    URL.revokeObjectURL(playlist[index].blobUrl);
    playlist.splice(index, 1);

    if (playlist.length === 0) {
      // No more videos, show drop zone
      if (player) {
        player.pause();
        player.src('');
      }
      currentIndex = -1;
      playerContainer.classList.add('hidden');
      dropZone.style.display = '';
      document.title = 'VideoJS Local Player';
      return;
    }

    if (index === currentIndex) {
      // Play next or previous
      const newIndex = Math.min(index, playlist.length - 1);
      currentIndex = -1; // Reset so playVideo works
      playVideo(newIndex);
    } else if (index < currentIndex) {
      currentIndex--;
    }

    updatePlaylistUI();
  }

  // ===== Drop Zone Events =====
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    // Only remove if leaving the drop zone itself
    if (e.target === dropZone || !dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  });

  // Click to browse
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = '';
  });

  // ===== Player Container Drag & Drop (for adding more videos) =====
  playerContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  playerContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  });

  // ===== Header Buttons =====
  backBtn.addEventListener('click', () => {
    if (player) {
      player.pause();
    }
    playerContainer.classList.add('hidden');
    dropZone.style.display = '';
    document.title = 'VideoJS Local Player';
  });

  pipBtn.addEventListener('click', async () => {
    if (!player) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await player.requestPictureInPicture();
        showToast('Picture-in-Picture enabled');
      }
    } catch (err) {
      showToast('PiP not supported for this video');
    }
  });

  fullscreenBtn.addEventListener('click', async () => {
    const v10Player = document.querySelector('video-player') || playerContainer;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await v10Player.requestFullscreen();
      }
    } catch (err) {
      showToast('Fullscreen error');
    }
  });

  // ===== Add More Button =====
  addMoreBtn.addEventListener('click', () => {
    playlistFileInput.click();
  });

  playlistFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = '';
  });

  volumeBoostSlider.addEventListener('input', (e) => {
    setVolumeBoost(e.target.value, false);
  });

  volumeBoostSlider.addEventListener('change', (e) => {
    setVolumeBoost(e.target.value, true);
  });

  volumeBoostReset.addEventListener('click', () => {
    setVolumeBoost(DEFAULT_BOOST, true);
  });

  document.addEventListener('pointerdown', resumeAudioContext, { passive: true });



  // ===== Cleanup on page unload =====
  window.addEventListener('beforeunload', () => {
    playlist.forEach(item => URL.revokeObjectURL(item.blobUrl));
    if (audioContext) audioContext.close().catch(() => {});
  });

})();
