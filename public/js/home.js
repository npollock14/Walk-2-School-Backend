async function fetchUserInfo() {
  const sessionToken = getCookie("session");

  if (!sessionToken) {
    // Redirect to login page if not logged in
    window.location.href = "/login"; // Replace with the actual login page URL
    return;
  }

  // set loading state
  document.getElementById("loading").style.display = "block";

  try {
    const response = await fetch("/get-user-info", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionToken }),
    });

    // remove loading state
    document.getElementById("loading").style.display = "none";

    if (response.ok) {
      return await response.json();
    } else {
      throw new Error("Failed to fetch user info");
    }
  } catch (error) {
    // remove loading state
    document.getElementById("loading").style.display = "none";

    console.error("Error:", error);
    // redirect to login page if there is an error and delete the session cookie
    document.cookie = `session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;`;
    window.location.href = "/login";
    return null;
  }
}

async function initHomePage() {
  const userInfo = await fetchUserInfo();

  if (userInfo && userInfo.privileges === "admin") {
    document.getElementById("admin-actions").style.display = "block";
    document.getElementById("non-admin-content").style.display = "none";
  } else {
    document.getElementById("admin-actions").style.display = "none";
    document.getElementById("non-admin-content").style.display = "block";
  }
}

document.getElementById("view-shop-status").addEventListener("click", () => {
  // Redirect to shop status page
  window.location.href = "/shop-status";
});

document.getElementById("view-orders").addEventListener("click", () => {
  // Redirect to orders page
  window.location.href = "/order-dashboard";
});

document.getElementById("logout").addEventListener("click", () => {
  // Delete the session cookie
  document.cookie = `session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;`;
  // Redirect to login page
  window.location.href = "/login";
});

initHomePage();
