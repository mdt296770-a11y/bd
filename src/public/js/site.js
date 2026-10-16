(() => {
 const carousel=document.querySelector('[data-carousel]');
 if(carousel){const slides=[...carousel.querySelectorAll('[data-slide]')],dots=[...carousel.querySelectorAll('[data-dot]')];let active=0,timer;const show=i=>{if(!slides.length)return;active=(i+slides.length)%slides.length;slides.forEach((s,n)=>s.classList.toggle('active',n===active));dots.forEach((d,n)=>d.classList.toggle('active',n===active));};const start=()=>{clearInterval(timer);if(slides.length>1)timer=setInterval(()=>show(active+1),5000);};carousel.querySelector('[data-prev]')?.addEventListener('click',()=>{show(active-1);start()});carousel.querySelector('[data-next]')?.addEventListener('click',()=>{show(active+1);start()});dots.forEach(d=>d.addEventListener('click',()=>{show(Number(d.dataset.dot));start()}));carousel.addEventListener('mouseenter',()=>clearInterval(timer));carousel.addEventListener('mouseleave',start);start();}
 const menu=document.querySelector('.menu-toggle');menu?.addEventListener('click',()=>document.querySelector('.main-nav')?.classList.toggle('nav-open'));
})();
(() => {
 const menu=document.querySelector('.menu-toggle');
 menu?.addEventListener('click',()=>{const open=document.querySelector('.main-nav')?.classList.contains('nav-open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'মেনু বন্ধ করুন':'মেনু খুলুন');});
 const big=document.getElementById('main-product-image');
 document.querySelectorAll('[data-gallery]').forEach(b=>b.addEventListener('click',()=>{if(big)big.src=b.dataset.gallery;document.querySelectorAll('[data-gallery]').forEach(x=>x.classList.toggle('active',x===b));}));
 const carousel=document.querySelector('[data-carousel]');
 if(carousel&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){carousel.dispatchEvent(new Event('mouseenter'));}
})();
