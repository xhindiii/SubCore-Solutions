function sendEmail(event) {
  event.preventDefault();

  const name = document.getElementById("name").value;
  const message = document.getElementById("message").value;

  const subject = encodeURIComponent("Contact from Website - " + name);
  const body = encodeURIComponent(message);

  window.location.href = `mailto:info@subcoresolutions.online?subject=${subject}&body=${body}`;
}
