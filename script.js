(function () {
  var trigger = document.querySelector('.avatar-btn');
  if (!trigger) return;

  var dialog = null;

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'photo-dialog';
    dialog.setAttribute('aria-label', 'Photo of Ian Pedersen');
    dialog.innerHTML =
      '<button type="button" class="photo-close" aria-label="Close photo">&times;</button>' +
      '<img src="images/headshot-large.jpg" alt="Ian Pedersen">';
    dialog.addEventListener('click', function () { dialog.close(); });
    document.body.appendChild(dialog);
  }

  trigger.addEventListener('click', function () {
    if (!dialog) build();
    dialog.showModal();
  });
})();
