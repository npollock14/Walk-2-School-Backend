function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

function redirectToAppropriatePage() {
  const sessionCookie = getCookie("session");

  if (sessionCookie) {
    // User is signed in, redirect to the home page
    window.location.href = "/home"; // Replace with the actual home page URL
  } else {
    // User is not signed in, redirect to the login page
    window.location.href = "/login"; // Replace with the actual login page URL
  }
}
