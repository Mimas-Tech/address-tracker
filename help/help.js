const navLinks = document.querySelectorAll('.help-nav a');
const sections = document.querySelectorAll('section[id]');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    }
  });
}, { rootMargin: '-20% 0px -70% 0px' });
sections.forEach((s) => observer.observe(s));
