/* Vamp Shmot Ink Bleed — no dependencies. */
(function (global) {
  class VampInkBleed {
    constructor(target, options = {}) {
      if (!target) throw new Error('Target element is required');
      this.target = target;
      this.options = { logo: './assets/vamp_logo_vectorized(2).svg', autoHide: true, ...options };
      this.timer = null;
      this.done = false;
      this.render();
      this.replay();
    }
    render() {
      const root = document.createElement('div');
      root.className = 'vamp-loader';
      root.setAttribute('role', 'status');
      root.setAttribute('aria-label', 'Загрузка Vamp Shmot');
      root.innerHTML = `<div class="vamp-stage" aria-hidden="true">
        <img class="vamp-part bat" alt=""><img class="vamp-part vamp" alt=""><img class="vamp-part shmot" alt="">
        <img class="vamp-original" alt="Vamp Shmot">
        <i class="drop large"></i><i class="drop small"></i>
        <i class="splash"></i><i class="run run-1"></i><i class="run run-2"></i><i class="run run-3"></i>
      </div>
      <div class="vamp-progress" aria-hidden="true"><div class="vamp-progress-label"><span>LOADING / ЗАГРУЗКА</span><span class="vamp-percent">000%</span></div><div class="vamp-track"><div class="vamp-fill"></div></div></div>`;
      const base = this.options.logo.slice(0, this.options.logo.lastIndexOf('/') + 1);
      root.querySelector('.bat').src = base + 'bat.svg';
      root.querySelector('.vamp').src = base + 'vamp.svg';
      root.querySelector('.shmot').src = base + 'shmot.svg';
      root.querySelector('.vamp-original').src = this.options.logo;
      this.target.replaceChildren(root);
      this.root = root;
    }
    setProgress(value) {
      if (this.done) return;
      const progress = Math.max(0, Math.min(100, Number(value) || 0));
      this.root.style.setProperty('--progress', progress + '%');
      this.root.querySelector('.vamp-percent').textContent = String(Math.floor(progress)).padStart(3, '0') + '%';
      this.root.setAttribute('aria-label', 'Загрузка Vamp Shmot: ' + Math.floor(progress) + '%');
    }
    replay() {
      clearTimeout(this.timer);
      this.done = false;
      this.target.hidden = false;
      this.started = performance.now();
      this.root.classList.remove('playing', 'final', 'exit');
      this.setProgress(0);
      void this.root.offsetWidth;
      this.root.classList.add('playing');
    }
    complete() {
      if (this.done) return;
      this.setProgress(100);
      this.done = true;
      this.timer = setTimeout(() => {
        this.root.classList.remove('playing');
        this.root.classList.add('final');
        this.root.dispatchEvent(new CustomEvent('vampinkbleed:complete', { bubbles: true }));
        if (this.options.autoHide) this.timer = setTimeout(() => {
          this.root.classList.add('exit');
          this.timer = setTimeout(() => { this.target.hidden = true; }, 550);
        }, 650);
      }, Math.max(0, 5100 - (performance.now() - this.started)));
    }
    destroy() {
      clearTimeout(this.timer);
      this.target.replaceChildren();
      this.target.hidden = false;
    }
  }
  global.VampInkBleed = VampInkBleed;
})(window);
