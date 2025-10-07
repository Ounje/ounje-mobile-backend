# Authentication Flow
    #Registration
    1. The frontend collects the user email and makes a request to api/auth/request-otp
    2. If successful the backend responds with "otp sent to email".
    3. Then the frontend collects the otp the user inputs along with the email and sends it to api/auth/verify-otp
    4. if sucessful the backend responds with a jwt containing the email as payload which lasts for 30m.
    5. The frontend stores that payload and sends it together with all other user information collected for registration and sends it to api/auth/register
    6. The backend checks if the email or phone number entered already exists. If not proceeds to create the new user and sign a jwt containing the user id as payload that lasts 1 day.
    7. The frontend stores the jwt and passes it in the authorisation header of a request to get the user information.
    

    #Login
    1. The frontend collects user email and makes a request to api/auth/login
    2. The backend sends an otp to the email and responds with "otp sent to email"
    3. Then the frontend collects the otp the user inputs and sends it to api/auth/verify-otp
    4. The backend verifies the otp, finds the user and signs a jwt containing user id with some additional information.
    5. The frontend stores the jwt and passes it in the authorisation header of a request to get the user information if needed.


# Getting Users
    #Customer
    1. The frontend sends the jwt in an authorisation header to api/customers/profile

    #Vendor
    1. The frontend sends the jwt in an authorisation header to api/vendors/profile


# Creating Dishes
    1. Frontend makes a request to api/dishes/create-dish.
    2. The request should contain name, description, category, price, options.
    3. Options would contain the category of the plate as well as the items in the plate.
    4. Each item would have a name, price and image
    5. If successful the dish saves and responds with "dish created successfully"

       