function change() {
	document.querySelector('.me').innerHTML = 'tu' + 'tu';
}
if (document.readyState != "loading") change();
else document.addEventListener('DOMContentLoaded', change);

