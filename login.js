const loginForm = document.getElementById("login-form");
const errorMessage = document.getElementById("error-message");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = loginForm.username.value;
  const password = loginForm.password.value;

  try {
    const response = await fetch("/authenticate-raw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    if (response.ok) {
      const data = await response.json();
      const sessionToken = data.sessionToken;

      // Set the session cookie
      document.cookie = `session=${sessionToken}; path=/`;

      console.log("Login successful. Setting session cookie:", sessionToken);

      // Redirect to home page
      window.location.href = "/home"; // Replace with the actual home page URL
    } else {
      const errorData = await response.json();
      errorMessage.textContent = errorData.message || "Error during login";
      console.error("Error:", errorData);
    }
  } catch (error) {
    console.error("Error:", error);
    errorMessage.textContent = "Error during login";
  }
});
